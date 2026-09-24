// 재현 가능한 난수. 상태가 숫자 하나라서 게임 상태에 그대로 저장된다.
// (mulberry32 — 게임용으로 충분하다. 암호용이 아니다.)

export function nextRandom(state: number): [number, number] {
  let a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, a];
}

/** 상태를 들고 다니는 작은 난수기 */
export class Rng {
  constructor(public state: number) {
    this.state = state >>> 0;
  }
  next(): number {
    const [v, s] = nextRandom(this.state);
    this.state = s;
    return v;
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }
}

/** 여러 값으로 새 씨앗을 만든다(봇마다·턴마다 다른 난수를 쓰되 재현 가능하게). */
export function mixSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    let x = p >>> 0;
    for (let i = 0; i < 4; i++) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
      x >>>= 8;
    }
  }
  return h >>> 0;
}
