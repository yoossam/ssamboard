/*
 * QR 코드 만들기(2026-11-28 수업 보드 — 학생이 퀴즈·자료 주소를 휴대폰 카메라로 바로 열게).
 * 바깥 라이브러리 없이 표준(ISO/IEC 18004) 그대로: 바이트 방식, 오류 정정 M(약 15% 가려져도 읽힘), 1~10판(바이트 213자까지).
 * 마스크는 여덟 가지를 모두 그려 벌점이 가장 낮은 것을 고른다. 결과가 맞는지는 시험에서 널리 쓰는 qrcode 라이브러리의 결과와 칸마다 견줘 확인했다.
 */

type Grid = boolean[][];
// shared 는 DOM 타입 없이 묶는다 — TextEncoder 는 브라우저·Node 모두에 있다
declare const TextEncoder: new () => { encode(s: string): Uint8Array };

// 판(version) 1~10, 오류 정정 M: [블록당 정정 바이트, [블록 수, 블록당 자료 바이트][]]
const BLOCKS_M: [number, [number, number][]][] = [
  [10, [[1, 16]]],
  [16, [[1, 28]]],
  [26, [[1, 44]]],
  [18, [[2, 32]]],
  [24, [[2, 43]]],
  [16, [[4, 27]]],
  [18, [[4, 31]]],
  [
    22,
    [
      [2, 38],
      [2, 39],
    ],
  ],
  [
    22,
    [
      [3, 36],
      [2, 37],
    ],
  ],
  [
    26,
    [
      [4, 43],
      [1, 44],
    ],
  ],
];
const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
/** 오류 정정 M 의 형식 비트 표시(00 이 아니라 표의 'M' = 0b00) */
const ECC_M_BITS = 0;

const dataCapacity = (v: number): number => BLOCKS_M[v - 1]![1].reduce((a, [n, d]) => a + n * d, 0);

// ── 갈루아 체(GF(256), 다항식 0x11D) 리드-솔로몬 ──
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j]!, root);
      if (j + 1 < r.length) r[j] ^= r[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data: number[], divisor: number[]): number[] {
  const r = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ r.shift()!;
    r.push(0);
    divisor.forEach((c, i) => (r[i] ^= gfMul(c, factor)));
  }
  return r;
}

/** 주소(글자)를 QR 칸 표로. 너무 길면 null(10판 M 에 213바이트까지). */
export function qrMatrix(text: string, force?: { version?: number; mask?: number }): Grid | null {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 0;
  for (let v = force?.version ?? 1; v <= 10; v++) {
    const bits = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
    if (bits <= dataCapacity(v) * 8) {
      version = v;
      break;
    }
  }
  if (!version) return null;

  // 1) 자료 비트: 방식(0100 바이트) + 글자 수 + 자료 + 끝표시 + 채움
  const bits: number[] = [];
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCapacity(version) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // 2) 블록으로 나눠 정정 바이트를 붙이고, 차례로 섞는다
  const [ecLen, groups] = BLOCKS_M[version - 1]!;
  const div = rsDivisor(ecLen);
  const blocks: { d: number[]; e: number[] }[] = [];
  let k = 0;
  for (const [count, len] of groups)
    for (let i = 0; i < count; i++) {
      const d = data.slice(k, k + len);
      k += len;
      blocks.push({ d, e: rsRemainder(d, div) });
    }
  const codewords: number[] = [];
  const maxD = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) codewords.push(b.d[i]!);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) codewords.push(b.e[i]!);

  // 3) 고정 무늬
  const size = version * 4 + 17;
  const grid: Grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed: Grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, on: boolean) => {
    grid[y]![x] = on;
    fixed[y]![x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const al = ALIGN[version - 1]!;
  for (const ay of al)
    for (const ax of al) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === al[al.length - 1]) || (ax === al[al.length - 1] && ay === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  // 형식 자리(나중에 채움)와 판 정보(7판부터)
  const drawFormat = (mask: number) => {
    const d = (ECC_M_BITS << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const on = ((b >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const c = Math.floor(i / 3);
      set(a, c, on);
      set(c, a, on);
    }
  }

  // 4) 자료 칸 채우기(오른쪽 아래에서 두 줄씩 지그재그)
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fixed[y]![x]) continue;
        if (bi < codewords.length * 8) grid[y]![x] = ((codewords[bi >>> 3]! >>> (7 - (bi & 7))) & 1) !== 0;
        bi++;
      }
  }

  // 5) 마스크 여덟 가지 중 벌점이 가장 낮은 것
  const maskFn = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_x: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (m: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y]![x] && maskFn[m]!(x, y)) grid[y]![x] = !grid[y]![x];
  };
  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    if (force?.mask !== undefined && m !== force.mask) continue;
    applyMask(m);
    drawFormat(m);
    const s = penalty(grid);
    if (s < bestScore) {
      bestScore = s;
      best = m;
    }
    applyMask(m); // 되돌린다(XOR)
  }
  applyMask(best);
  drawFormat(best);
  return grid;
}

/** 표준의 네 가지 벌점(같은 색 줄, 2×2 덩어리, 찾기 무늬 닮은 꼴, 어두운 칸 비율) */
function penalty(g: Grid): number {
  const n = g.length;
  let score = 0;
  const lines = (get: (a: number, b: number) => boolean) => {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && get(a, b) === get(a, b - 1)) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      // 1:1:3:1:1 무늬(앞이나 뒤에 밝은 칸 넷)
      for (let b = 0; b + 10 < n + 4; b++) {
        const at = (i: number) => (i < 0 || i >= n ? false : get(a, i));
        const core = at(b) && !at(b + 1) && at(b + 2) && at(b + 3) && at(b + 4) && !at(b + 5) && at(b + 6);
        if (!core) continue;
        const before = !at(b - 1) && !at(b - 2) && !at(b - 3) && !at(b - 4);
        const after = !at(b + 7) && !at(b + 8) && !at(b + 9) && !at(b + 10);
        if (before || after) score += 40;
      }
    }
  };
  lines((a, b) => g[a]![b]!);
  lines((a, b) => g[b]![a]!);
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (g[y]![x] === g[y]![x + 1] && g[y]![x] === g[y + 1]![x] && g[y]![x] === g[y + 1]![x + 1]) score += 3;
  let dark = 0;
  for (const row of g) for (const c of row) if (c) dark++;
  score += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return score;
}

/** SVG 로(조용한 테두리 4칸 포함). 글자로 돌려주므로 화면에서 그대로 그린다. */
export function qrSvgPath(grid: Grid): { size: number; d: string } {
  const q = 4;
  let d = '';
  grid.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x + q} ${y + q}h1v1h-1z`)));
  return { size: grid.length + q * 2, d };
}
