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

import { applyCommit, applyUndo, applyRedo } from './commit.js';
import { loadDeck, DocError } from './doc.js';
import { PathError } from './paths.js';

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

  // 덱의 정적 자산 서빙은 M3 가 필요로 한다. M2-1 은 편집 경로만 연다.
  return sendJson(res, 404, { error: `알 수 없는 경로: ${req.method} ${url.pathname}` });
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
