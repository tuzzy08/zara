export interface PstnPremiumPlaybackAdmissionLease {
  release(): void;
}

const defaultAggregateResidentByteLimit = 32 * 1_024 * 1_024;

export class PstnPremiumPlaybackAdmission {
  private residentBytes = 0;

  constructor(private readonly residentByteLimit = defaultAggregateResidentByteLimit) {
    if (!Number.isInteger(residentByteLimit) || residentByteLimit <= 0) {
      throw new Error("Premium playback aggregate resident byte limit must be a positive integer.");
    }
  }

  acquire(byteLength: number): PstnPremiumPlaybackAdmissionLease {
    if (!Number.isInteger(byteLength) || byteLength < 0) {
      throw new Error("Premium playback resident byte length must be a non-negative integer.");
    }
    if (this.residentBytes + byteLength > this.residentByteLimit) {
      throw new Error("premium_playback_capacity_overflow");
    }
    this.residentBytes += byteLength;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.residentBytes -= byteLength;
      },
    };
  }

  getResidentBytes() {
    return this.residentBytes;
  }
}
