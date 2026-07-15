export interface PstnPremiumIngressAdmissionLease {
  release(): void;
}

const defaultAggregateResidentByteLimit = 32 * 1_024 * 1_024;

export class PstnPremiumIngressAdmission {
  private residentBytes = 0;

  constructor(private readonly residentByteLimit = defaultAggregateResidentByteLimit) {
    if (!Number.isInteger(residentByteLimit) || residentByteLimit <= 0) {
      throw new Error("Premium ingress aggregate resident byte limit must be a positive integer.");
    }
  }

  acquire(byteLength: number): PstnPremiumIngressAdmissionLease {
    if (!Number.isInteger(byteLength) || byteLength < 0) {
      throw new Error("Premium ingress resident byte length must be a non-negative integer.");
    }
    if (this.residentBytes + byteLength > this.residentByteLimit) {
      throw new Error("premium_ingress_capacity_exhausted");
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
