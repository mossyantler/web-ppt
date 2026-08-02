#!/usr/bin/env node
/**
 * HTTP 표면 — `POST /deck/:deckId/commit`, `GET /deck/:deckId`.
 *
 * 계획 §3.1 · §11 M2.
 *
 * **localhost 에만 바인딩한다.** 이 서버는 `_workspace/` 안의 파일을 쓰는 권한을
 * 갖고 인증이 없다. 외부 인터페이스에 노출되면 그 권한이 네트워크에 열린다.
 *
 * 라우팅 프레임워크를 쓰지 않는다 — 엔드포인트가 둘이고, 의존성 하나가 늘 때마다
 * 그 의존성의 기본 동작(본문 파서의 크기 한계, CORS 기본값)이 이 신뢰 경계의
 * 일부가 된다. 직접 쓰면 경계가 이 파일 안에 전부 보인다.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyCommit, applyUndo, applyRedo } from './commit.js';
import { loadDeck, DocError } from './doc.js';
import { PathError } from './paths.js';
import { listDecks, deckAssetPath } from './decks.js';
import { repoAssetPath } from './repo-assets.js';

/** 커밋 본문 상한. 슬라이드 하나의 재직렬화가 이보다 크면 명령이 잘못된 것이다. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export function createDeckServer() {
  return createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      sendError(res, err);
    }
  });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const commit = url.pathname.match(/^\/deck\/([^/]+)\/commit$/);
  const undo = url.pathname.match(/^\/deck\/([^/]+)\/(undo|redo)$/);
  const read = url.pathname.match(/^\/deck\/([^/]+)$/);

  if (commit && req.method === 'POST') {
    const deckId = decodeURIComponent(commit[1]);
    const envelope = JSON.parse(await readBody(req));
    return sendJson(res, 200, applyCommit(deckId, envelope));
  }

  if (undo && req.method === 'POST') {
    const deckId = decodeURIComponent(undo[1]);
    const fn = undo[2] === 'undo' ? applyUndo : applyRedo;
    return sendJson(res, 200, fn(deckId));
  }

  if (read && req.method === 'GET') {
    const deckId = decodeURIComponent(read[1]);
    const deck = loadDeck(deckId);
    return sendJson(res, 200, {
      deckId,
      docHash: deck.docHash,
      sectionCount: deck.sections.length,
      html: deck.raw,
    });
  }

  if (url.pathname === '/decks' && req.method === 'GET') {
    return sendJson(res, 200, { decks: listDecks() });
  }

  // 캔버스에 띄울 슬라이드 원본 (M3-2). 편집기가 iframe 으로 읽는다.
  //
  // **바이트를 손대지 않고 그대로 내준다.** 서버가 여기서 편집용 표시를 끼워 넣으면
  // 화면에 보이는 문서와 파일이 달라지고, 그 순간 "보이는 것이 저장된 것" 이라는
  // 약속이 깨진다. 편집기 표시는 부모 창이 iframe 안에 얹는다 (§Z2).
  //
  // 경로가 `/deck/<id>/page` 인 것도 우연이 아니다 — 덱은 자기 스타일시트를
  // `../../styles.css` 로 가리키고, 이 깊이라야 그게 서버 루트로 떨어진다.
  // `repoAssetPath` 가 그 자리를 받는다.
  const page = url.pathname.match(/^\/deck\/([^/]+)\/page$/);
  if (page && req.method === 'GET') {
    const deck = loadDeck(decodeURIComponent(page[1]));
    return sendHtml(res, deck.raw);
  }

  // 슬라이드가 참조하는 그림·글꼴. 덱 안의 파일만 나가고 봉쇄는 `deckAssetPath` 가 한다.
  const asset = url.pathname.match(/^\/deck\/([^/]+)\/asset\/(.+)$/);
  if (asset && req.method === 'GET') {
    const path = deckAssetPath(decodeURIComponent(asset[1]), decodeURIComponent(asset[2]));
    if (!path) return sendJson(res, 404, { error: '그런 파일이 없다' });
    return sendFile(res, path);
  }

  // 편집기 화면 (결정 11 — 서버가 화면도 같이 내준다).
  if (req.method === 'GET') {
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const path = uiAssetPath(rel);
    if (path) return sendFile(res, path);

    // 편집기 화면 파일이 아니면 슬라이드가 찾는 저장소 공용 파일일 수 있다.
    // 편집기 화면을 먼저 보는 이유 — 이름이 겹치면 우리 화면이 이겨야 한다.
    const shared = repoAssetPath(url.pathname);
    if (shared) return sendFile(res, shared);
  }

  return sendJson(res, 404, { error: `알 수 없는 경로: ${req.method} ${url.pathname}` });
}

/**
 * 편집기 화면 파일의 경로. `server/ui/` 밖으로는 절대 나가지 않는다.
 *
 * 덱과 달리 이건 우리가 만든 정적 파일이라 `_workspace` 봉쇄와 별개다. 그래도 경로를
 * 따로 봉쇄하는 이유는 같다 — 요청이 경로를 정하는 순간 그것은 신뢰 경계다.
 */
function uiAssetPath(rel) {
  const root = join(dirname(fileURLToPath(import.meta.url)), 'ui');
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return existsSync(abs) && statSync(abs).isFile() ? abs : null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

function sendFile(res, path) {
  const body = readFileSync(path);
  res.writeHead(200, {
    'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'content-length': body.length,
    // 편집 중 파일이 계속 바뀐다. 캐시가 남으면 고친 것이 화면에 안 나온다.
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendHtml(res, text) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new DocError(413, `요청 본문이 상한(${MAX_BODY_BYTES} bytes)을 넘었다`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function sendError(res, err) {
  const status = err instanceof DocError || err instanceof PathError ? err.status : 500;
  const body = { error: err.message, code: err.code };
  // 진단에 필요한 부속 필드는 그대로 싣는다 — 409 의 expected/actual 이 대표적이다.
  for (const k of ['expected', 'actual', 'registered', 'commandIndex', 'prefixOk', 'suffixOk']) {
    if (err[k] !== undefined) body[k] = err[k];
  }
  if (status === 500) body.stack = err.stack;
  sendJson(res, status, body);
}

/* ------------------------------------------------------------------ CLI */

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4321);
  createDeckServer().listen(port, '127.0.0.1', () => {
    console.log(`덱 서버 — http://127.0.0.1:${port}  (덱 루트: ${process.cwd()}/_workspace)`);
  });
}
