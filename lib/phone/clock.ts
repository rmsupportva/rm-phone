export interface Clock {
  now(): number;
}

/**
 * A clock you can move and speed up, so the demo can show "Friday after
 * candle lighting" without waiting for Friday. Real time keeps flowing from
 * whatever moment you set, at `speed` times normal.
 */
export class SimClock implements Clock {
  private base: number;
  private realBase: number;
  private _speed: number;

  constructor(start: number = Date.now(), speed = 1, private readonly realNow: () => number = Date.now) {
    this.base = start;
    this.realBase = realNow();
    this._speed = speed;
  }

  now(): number {
    return this.base + (this.realNow() - this.realBase) * this._speed;
  }

  get speed(): number {
    return this._speed;
  }

  setTime(ms: number): void {
    this.base = ms;
    this.realBase = this.realNow();
  }

  setSpeed(speed: number): void {
    this.setTime(this.now());
    this._speed = speed;
  }
}

/** A clock that only moves when told to. For tests. */
export class ManualClock implements Clock {
  constructor(private t: number) {}
  now(): number {
    return this.t;
  }
  advance(seconds: number): void {
    this.t += seconds * 1000;
  }
}
