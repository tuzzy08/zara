const defaultMaxBytes = 64 * 1_024;
const defaultMaxCount = 256;

export class PremiumProviderMessagePressure {
  private bytes = 0;
  private count = 0;

  constructor(private readonly limits: { maxBytes: number; maxCount: number } = {
    maxBytes: defaultMaxBytes,
    maxCount: defaultMaxCount,
  }) {}

  assertMessageWithinLimit(messageBytes: number) {
    if (messageBytes > this.limits.maxBytes) {
      throw new Error("premium_provider_output_overflow");
    }
  }

  acquire(messageBytes: number) {
    if (this.bytes + messageBytes > this.limits.maxBytes || this.count + 1 > this.limits.maxCount) {
      throw new Error("premium_provider_output_overflow");
    }
    this.bytes += messageBytes;
    this.count += 1;
    return this.getSnapshot();
  }

  release(messageBytes: number) {
    this.bytes = Math.max(0, this.bytes - messageBytes);
    this.count = Math.max(0, this.count - 1);
    return this.getSnapshot();
  }

  getSnapshot() {
    return { bytes: this.bytes, count: this.count };
  }
}
