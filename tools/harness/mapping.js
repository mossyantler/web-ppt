// 테마 매핑 조회 — core/grammar.md §2.4 가 요구하는 다섯 절(blocks·inlineClasses·
// dataProps·scaffolds·leafStructure)을 읽고 정/역방향 조회를 제공한다.
//
// 정방향: (data-el|data-box, data-variant) -> 클래스        ... §3.7 L7
// 역방향: 클래스 집합 -> (값, variant) 후보                  ... 하네스 진단용(Axis B)
//
// 역방향은 문법에 없는 연산이다. 픽스처가 주석되지 않은 상태(코퍼스 커버리지 0%[g4])에서
// "빨간불의 원인이 주석 부재인가, 어휘 부재인가"를 가르기 위해 하네스만 쓴다.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 테마 매핑의 단일 진실 원천. 하네스와 마이그레이터가 같은 파일을 읽는다 (계획 3판 M1 개정 기록 2). */
export const MAPPING_PATH = join(HERE, '..', '..', 'themes', 'snu', 'mapping.json');

export const REQUIRED_CLAUSES = ['blocks', 'regionSlots', 'inlineClasses', 'dataProps', 'scaffolds', 'leafStructure'];

export function loadMapping(path = MAPPING_PATH) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const missing = REQUIRED_CLAUSES.filter((c) => !(c in json));
  if (missing.length) {
    throw new Error(`mapping.json 필수 절 누락 (grammar.md §2.4): ${missing.join(', ')}`);
  }
  return new Mapping(json, path);
}

const norm = (classes) => [...classes].sort().join(' ');

export class Mapping {
  constructor(json, path) {
    this.json = json;
    this.path = path;
    this.reverse = new Map(); // 정규화된 클래스 집합 -> [{ key, value, variant, classes }]
    for (const [key, variants] of Object.entries(json.blocks)) {
      for (const [variant, cls] of Object.entries(variants)) {
        // region 은 두 축이다 — data-region(슬롯)이 클래스를, data-variant(조판)가 클래스를
        // 각각 낸다. 역방향 키는 그 곱집합이다 (계획 3판 M1 개정 기록 2 G-2).
        if (key === 'box:region') {
          for (const [slot, slotCls] of Object.entries(json.regionSlots)) {
            const classes = `${slotCls} ${cls}`.split(/\s+/).filter(Boolean);
            if (!classes.length) continue;
            const k = norm(classes);
            if (!this.reverse.has(k)) this.reverse.set(k, []);
            this.reverse.get(k).push({ key, value: 'region', variant, regionSlot: slot, classes });
          }
          continue;
        }
        const classes = cls.split(/\s+/).filter(Boolean);
        if (!classes.length) continue; // 클래스 없는 매핑(예: text/default = <p>)은 역방향 키가 없다
        const k = norm(classes);
        if (!this.reverse.has(k)) this.reverse.set(k, []);
        this.reverse.get(k).push({ key, value: valueOf(key), variant, classes });
      }
    }
    this.inlineClasses = new Set(json.inlineClasses);

    // 클래스 없는 매핑(예: text/default = 클래스 없는 <p>)은 역방향 키가 없다.
    // 그런 값은 기본 태그로만 되찾을 수 있다 — 클래스 없는 요소의 추정에 쓴다.
    this.byTag = new Map();
    for (const [key, variants] of Object.entries(json.blocks)) {
      for (const [variant, cls] of Object.entries(variants)) {
        if (cls.trim()) continue;
        const tag = json.defaultTag?.[key];
        if (!tag) continue;
        if (!this.byTag.has(tag)) this.byTag.set(tag, []);
        this.byTag.get(tag).push({ key, value: valueOf(key), variant, classes: [] });
      }
    }
  }

  /** (값, variant) -> 클래스 문자열. 선언되지 않은 쌍은 null (= insertElement 경로가 없다). */
  classFor(key, variant = 'default', regionSlot = null) {
    const v = this.json.blocks[key];
    if (!v) return null;
    if (!(variant in v)) return null;
    if (key !== 'box:region') return v[variant];
    // region 의 실효 클래스 = 슬롯 클래스 + 조판 variant 클래스 (§2.2)
    const slotCls = regionSlot === null ? null : this.json.regionSlots[regionSlot];
    if (slotCls === undefined) return null;
    return [slotCls, v[variant]].filter(Boolean).join(' ');
  }

  /** `data-region` 의 닫힌 열거 (= regionSlots 의 키). */
  regionSlots() {
    return Object.keys(this.json.regionSlots);
  }

  /** 선언된 (값, variant) 쌍 전체. */
  variantsOf(key) {
    return Object.keys(this.json.blocks[key] ?? {});
  }

  hasBlockKey(key) {
    return key in this.json.blocks;
  }

  defaultTagFor(key) {
    return this.json.defaultTag?.[key] ?? 'div';
  }

  /**
   * 클래스 집합의 역방향 조회. 정확 일치 우선, 없으면 부분집합 후보를 반환한다.
   * 반환: { exact: [...], partial: [{ cand, extraClasses }] }
   */
  lookupClasses(classes) {
    const exact = this.reverse.get(norm(classes)) ?? [];
    if (exact.length) return { exact, partial: [] };
    const set = new Set(classes);
    const partial = [];
    for (const cands of this.reverse.values()) {
      for (const cand of cands) {
        if (cand.classes.every((c) => set.has(c))) {
          partial.push({ cand, extraClasses: classes.filter((c) => !cand.classes.includes(c)) });
        }
      }
    }
    // 더 많은 클래스를 소비한 후보(= 더 구체적인 매핑)를 먼저 본다.
    partial.sort((a, b) => b.cand.classes.length - a.cand.classes.length);
    return { exact: [], partial };
  }

  /** 클래스가 없는 요소의 추정 — 기본 태그로만 되찾는다. */
  lookupTag(tag) {
    return this.byTag.get(tag) ?? [];
  }

  leafStructureOf(value) {
    return this.json.leafStructure[value] ?? null;
  }

  isDeclaredStructuralChild(parentValue, tag, classes) {
    const decl = this.leafStructureOf(parentValue);
    if (!decl) return false;
    return decl.some((d) => d.tag === tag && (d.class ? classes.includes(d.class) : true));
  }

  dataPropsOf(value) {
    return this.json.dataProps[value] ?? null;
  }

  scaffoldOf(value) {
    return this.json.scaffolds[value] ?? null;
  }

  isOpaqueLeaf(value) {
    return value in (this.json.opaqueLeaves ?? {});
  }

  opaqueLeafInfo(value) {
    return this.json.opaqueLeaves?.[value] ?? null;
  }

  isVoidLeaf(value) {
    return (this.json.voidLeaves ?? []).includes(value);
  }
}

export function valueOf(key) {
  const i = key.indexOf(':');
  return i === -1 ? key : key.slice(i + 1);
}

export function keyFor(kind, value) {
  return kind === 'section' ? 'section' : `${kind}:${value}`;
}
