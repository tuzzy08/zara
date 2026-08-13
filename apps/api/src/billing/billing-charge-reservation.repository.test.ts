import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BillingChargeReservationRepository } from "./billing-charge-reservation.repository";
import { PostgresBillingLedgerRepository } from "./postgres-billing-ledger.repository";

const byoChargeContext = {
  runtimePath: "pstn-sandwich",
  ownershipMode: "byo",
  provider: "twilio",
  direction: "inbound",
} as const;

describe("BillingChargeReservationRepository", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;

  beforeEach(async () => {
    const database = newDb();
    database.public.none(`
      create table billing_payg_orders (
        tenant_id text not null,
        id text not null,
        provider_order_id text not null unique,
        currency text not null,
        paid_amount_minor bigint not null,
        granted_credit_minor bigint not null,
        status text not null,
        created_at timestamptz not null,
        primary key (tenant_id, id)
      );
      create table billing_payg_credit_entries (
        tenant_id text not null,
        id text not null,
        order_id text,
        session_id text,
        entry_type text not null,
        amount_minor bigint not null,
        idempotency_key text not null,
        expires_at timestamptz,
        created_at timestamptz not null,
        primary key (tenant_id, id),
        unique (tenant_id, idempotency_key)
      );
      create table billing_reservation_accounts (
        tenant_id text primary key,
        reserved_amount_minor bigint not null default 0,
        updated_at timestamptz not null
      );
      create table billing_charge_reservations (
        tenant_id text not null,
        id text not null,
        reservation_key text not null,
        catalog_id text,
        charge_context jsonb,
        funding_source text not null,
        status text not null,
        reserved_amount_minor bigint not null,
        actual_amount_minor bigint,
        session_id text,
        terminal_outcome text,
        currency text not null,
        expires_at timestamptz not null,
        finalized_at timestamptz,
        released_at timestamptz,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        primary key (tenant_id, id),
        unique (tenant_id, reservation_key)
      );
      create table billing_terminal_recovery_jobs (
        tenant_id text not null,
        id text not null,
        idempotency_key text not null,
        call_session_id text not null,
        reservation_id text not null,
        commercial_mode text not null,
        usage_fact jsonb not null,
        settlement_fact jsonb not null,
        status text not null,
        attempt_count integer not null,
        next_attempt_at timestamptz not null,
        lease_expires_at timestamptz,
        last_error text,
        completed_at timestamptz,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        primary key (tenant_id, id),
        unique (tenant_id, idempotency_key)
      )
    `);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
    const ledger = new PostgresBillingLedgerRepository(pool);
    await ledger.applyPaidPaygOrder({
      order: {
        id: "payg-order-1",
        organizationId: "tenant-payg",
        providerOrderId: "polar-order-1",
        currency: "usd",
        paidAmountMinor: 500,
        grantedCreditMinor: 500,
        status: "paid",
        createdAt: "2026-08-10T09:00:00.000Z",
      },
      grant: {
        id: "payg-grant-1",
        organizationId: "tenant-payg",
        orderId: "payg-order-1",
        entryType: "grant",
        amountMinor: 500,
        idempotencyKey: "payg-grant:polar-order-1",
        createdAt: "2026-08-10T09:00:00.000Z",
      },
    });
    await pool.query(
      `insert into billing_payg_credit_entries (
         tenant_id, id, order_id, session_id, entry_type, amount_minor,
         idempotency_key, expires_at, created_at
       ) values (
         'tenant-other', 'payg-grant-other', null, null, 'grant', 500,
         'payg-grant:other', null, '2026-08-10T09:00:00.000Z'
       )`,
    );
  });

  afterEach(async () => {
    await pool.end();
  });

  it("prevents concurrent PAYG calls from reserving more than paid credit", async () => {
    const repository = new BillingChargeReservationRepository(pool);
    const requests = ["call-1", "call-2"].map((callSessionId) =>
      repository.reservePaygCredit({
        id: `reservation-${callSessionId}`,
        organizationId: "tenant-payg",
        reservationKey: `pstn:${callSessionId}`,
        catalogId: "catalog-2026-08-v1",
        chargeContext: byoChargeContext,
        amountMinor: 300,
        currency: "usd",
        expiresAt: "2026-08-10T10:05:00.000Z",
        now: "2026-08-10T10:00:00.000Z",
      }),
    );

    const results = await Promise.all(requests);

    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: "reserved", availableMinor: 200 }),
      {
        outcome: "denied",
        reason: "insufficient_payg_credit",
        availableMinor: 200,
      },
    ]));
    await expect(repository.listReservations("tenant-payg")).resolves.toEqual([
      expect.objectContaining({
        status: "active",
        reservedAmountMinor: 300,
      }),
    ]);
  });

  it("returns the original reservation when a stable request is retried later", async () => {
    const repository = new BillingChargeReservationRepository(pool);
    const request = {
      id: "reservation-retry",
      organizationId: "tenant-payg",
      reservationKey: "pstn:retry-call",
      catalogId: "catalog-2026-08-v1",
      chargeContext: byoChargeContext,
      amountMinor: 265,
      currency: "usd" as const,
      expiresAt: "2026-08-10T10:05:00.000Z",
      now: "2026-08-10T10:00:00.000Z",
    };

    const first = await repository.reservePaygCredit(request);
    const replay = await repository.reservePaygCredit({
      ...request,
      id: "reservation-retry-generated-again",
      now: "2026-08-10T10:01:00.000Z",
    });

    expect(replay).toEqual({
      ...first,
      duplicate: true,
    });

    await expect(repository.reservePaygCredit({
      ...request,
      catalogId: "catalog-changed",
      chargeContext: byoChargeContext,
      now: "2026-08-10T10:02:00.000Z",
    })).rejects.toThrow(
      "Reservation key pstn:retry-call already has different data.",
    );
  });

  it("releases an abandoned reservation at expiry so a new call can reserve", async () => {
    const repository = new BillingChargeReservationRepository(pool);
    await repository.reservePaygCredit({
      id: "reservation-abandoned",
      organizationId: "tenant-payg",
      reservationKey: "pstn:abandoned-call",
      catalogId: "catalog-2026-08-v1",
      chargeContext: byoChargeContext,
      amountMinor: 400,
      currency: "usd",
      expiresAt: "2026-08-10T10:05:00.000Z",
      now: "2026-08-10T10:00:00.000Z",
    });

    const recovered = await repository.reservePaygCredit({
      id: "reservation-recovered",
      organizationId: "tenant-payg",
      reservationKey: "pstn:recovered-call",
      catalogId: "catalog-2026-08-v1",
      chargeContext: byoChargeContext,
      amountMinor: 400,
      currency: "usd",
      expiresAt: "2026-08-10T10:10:00.000Z",
      now: "2026-08-10T10:05:00.000Z",
    });

    expect(recovered).toMatchObject({
      outcome: "reserved",
      duplicate: false,
      availableMinor: 100,
    });
    await expect(repository.listReservations("tenant-payg")).resolves.toEqual([
      expect.objectContaining({ id: "reservation-abandoned", status: "expired" }),
      expect.objectContaining({ id: "reservation-recovered", status: "active" }),
    ]);
  });

  it.each(["pending", "dead_letter"] as const)(
    "does not expire a reservation while terminal recovery is %s",
    async (recoveryStatus) => {
    const repository = new BillingChargeReservationRepository(pool);
    await repository.reservePaygCredit({
      id: "reservation-terminal-pending",
      organizationId: "tenant-payg",
      reservationKey: "payg-call:terminal-pending",
      catalogId: "catalog-2026-08-v1",
      chargeContext: byoChargeContext,
      amountMinor: 400,
      currency: "usd",
      expiresAt: "2026-08-10T10:05:00.000Z",
      now: "2026-08-10T10:00:00.000Z",
    });
    await pool.query(
      `insert into billing_terminal_recovery_jobs (
         tenant_id, id, idempotency_key, call_session_id, reservation_id,
         commercial_mode, usage_fact, settlement_fact, status, attempt_count,
         next_attempt_at, created_at, updated_at
       ) values (
         'tenant-payg', 'terminal-job-pending', 'terminal:pending', 'terminal-pending',
         'reservation-terminal-pending', 'payg', '{}', '{}', $1, 1,
         '2026-08-10T10:05:30.000Z', '2026-08-10T10:04:59.000Z',
         '2026-08-10T10:04:59.000Z'
       )`,
      [recoveryStatus],
    );

    await expect(repository.reservePaygCredit({
      id: "reservation-after-terminal-pending",
      organizationId: "tenant-payg",
      reservationKey: "payg-call:after-terminal-pending",
      catalogId: "catalog-2026-08-v1",
      chargeContext: byoChargeContext,
      amountMinor: 400,
      currency: "usd",
      expiresAt: "2026-08-10T10:10:00.000Z",
      now: "2026-08-10T10:05:00.000Z",
    })).resolves.toEqual({
      outcome: "denied",
      reason: "insufficient_payg_credit",
      availableMinor: 100,
    });
    await expect(repository.getReservation(
      "tenant-payg",
      "reservation-terminal-pending",
    )).resolves.toMatchObject({ status: "active" });
    },
  );

  it("rolls back expiry when the reservation account cannot release all claims", async () => {
    const repository = new BillingChargeReservationRepository(pool);
    await repository.reservePaygCredit({
      id: "reservation-corrupt-expiry",
      organizationId: "tenant-payg",
      reservationKey: "pstn:corrupt-expiry",
      catalogId: "catalog-2026-08-v1",
      chargeContext: byoChargeContext,
      amountMinor: 400,
      currency: "usd",
      expiresAt: "2026-08-10T10:05:00.000Z",
      now: "2026-08-10T10:00:00.000Z",
    });
    await pool.query(
      `update billing_reservation_accounts
       set reserved_amount_minor = 100
       where tenant_id = 'tenant-payg'`,
    );

    await expect(repository.reservePaygCredit({
      id: "reservation-after-corrupt-expiry",
      organizationId: "tenant-payg",
      reservationKey: "pstn:after-corrupt-expiry",
      catalogId: "catalog-2026-08-v1",
      chargeContext: byoChargeContext,
      amountMinor: 100,
      currency: "usd",
      expiresAt: "2026-08-10T10:10:00.000Z",
      now: "2026-08-10T10:05:00.000Z",
    })).rejects.toThrow(
      "Billing reservation account tenant-payg cannot release expired claims.",
    );
    await expect(repository.listReservations("tenant-payg")).resolves.toEqual([
      expect.objectContaining({ id: "reservation-corrupt-expiry", status: "active" }),
    ]);
  });

  it("finalizes actual PAYG usage once and releases the unused reservation", async () => {
    const repository = new BillingChargeReservationRepository(pool);
    const ledger = new PostgresBillingLedgerRepository(pool);
    await repository.reservePaygCredit({
      id: "reservation-finalized",
      organizationId: "tenant-payg",
      reservationKey: "pstn:finalized-call",
      catalogId: "catalog-2026-08-v1",
      chargeContext: byoChargeContext,
      amountMinor: 400,
      currency: "usd",
      expiresAt: "2026-08-10T10:05:00.000Z",
      now: "2026-08-10T10:00:00.000Z",
    });
    const input = {
      organizationId: "tenant-payg",
      reservationId: "reservation-finalized",
      sessionId: "finalized-call",
      actualAmountMinor: 150,
      terminalOutcome: "completed" as const,
      now: "2026-08-10T10:04:00.000Z",
    };

    const first = await repository.finalizePaygCredit(input);
    const replay = await repository.finalizePaygCredit(input);
    await expect(repository.finalizePaygCredit({
      ...input,
      terminalOutcome: "transferred",
    })).rejects.toThrow("was finalized with different data");

    expect({ first, replay }).toEqual({
      first: {
        outcome: "finalized",
        duplicate: false,
        chargedMinor: 150,
        releasedMinor: 250,
        availableMinor: 350,
      },
      replay: {
        outcome: "finalized",
        duplicate: true,
        chargedMinor: 150,
        releasedMinor: 250,
        availableMinor: 350,
      },
    });
    await expect(repository.listReservations("tenant-payg")).resolves.toEqual([
      expect.objectContaining({
        id: "reservation-finalized",
        status: "finalized",
        actualAmountMinor: 150,
        sessionId: "finalized-call",
        terminalOutcome: "completed",
      }),
    ]);
    await expect(ledger.listPaygCreditEntries("tenant-payg")).resolves.toEqual([
      expect.objectContaining({ entryType: "grant", amountMinor: 500 }),
      expect.objectContaining({
        id: "payg-reservation-debit:reservation-finalized",
        sessionId: "finalized-call",
        entryType: "debit",
        amountMinor: 150,
        idempotencyKey: "payg-reservation:reservation-finalized:finalize",
      }),
    ]);
  });

  it("rolls back finalization when the reservation account claim is missing", async () => {
    const repository = new BillingChargeReservationRepository(pool);
    const ledger = new PostgresBillingLedgerRepository(pool);
    await repository.reservePaygCredit({
      id: "reservation-corrupt-finalization",
      organizationId: "tenant-payg",
      reservationKey: "pstn:corrupt-finalization",
      catalogId: "catalog-2026-08-v1",
      chargeContext: byoChargeContext,
      amountMinor: 400,
      currency: "usd",
      expiresAt: "2026-08-10T10:05:00.000Z",
      now: "2026-08-10T10:00:00.000Z",
    });
    await pool.query(
      `update billing_reservation_accounts
       set reserved_amount_minor = 0
       where tenant_id = 'tenant-payg'`,
    );

    await expect(repository.finalizePaygCredit({
      organizationId: "tenant-payg",
      reservationId: "reservation-corrupt-finalization",
      sessionId: "corrupt-finalization",
      actualAmountMinor: 150,
      terminalOutcome: "completed",
      now: "2026-08-10T10:04:00.000Z",
    })).rejects.toThrow(
      "Billing reservation reservation-corrupt-finalization has no active claim.",
    );
    await expect(repository.getReservation(
      "tenant-payg",
      "reservation-corrupt-finalization",
    )).resolves.toMatchObject({ status: "active" });
    await expect(ledger.listPaygCreditEntries("tenant-payg")).resolves.toEqual([
      expect.objectContaining({ entryType: "grant" }),
    ]);
  });

  it("does not expose or finalize a reservation through another tenant", async () => {
    const repository = new BillingChargeReservationRepository(pool);
    await repository.reservePaygCredit({
      id: "reservation-victim",
      organizationId: "tenant-payg",
      reservationKey: "pstn:victim",
      catalogId: "catalog-2026-08-v1",
      chargeContext: byoChargeContext,
      amountMinor: 300,
      currency: "usd",
      expiresAt: "2026-08-10T10:05:00.000Z",
      now: "2026-08-10T10:00:00.000Z",
    });
    await repository.reservePaygCredit({
      id: "reservation-attacker",
      organizationId: "tenant-other",
      reservationKey: "pstn:attacker",
      catalogId: "catalog-2026-08-v1",
      chargeContext: byoChargeContext,
      amountMinor: 100,
      currency: "usd",
      expiresAt: "2026-08-10T10:05:00.000Z",
      now: "2026-08-10T10:00:00.000Z",
    });

    await expect(repository.getReservation(
      "tenant-other",
      "reservation-victim",
    )).resolves.toBeNull();
    await expect(repository.finalizePaygCredit({
      organizationId: "tenant-other",
      reservationId: "reservation-victim",
      sessionId: "guessed-victim-session",
      actualAmountMinor: 50,
      terminalOutcome: "completed",
      now: "2026-08-10T10:01:00.000Z",
    })).rejects.toThrow("Billing reservation reservation-victim was not found.");
    await expect(repository.getReservation(
      "tenant-payg",
      "reservation-victim",
    )).resolves.toMatchObject({
      organizationId: "tenant-payg",
      status: "active",
    });
  });

  it("releases a failed-start reservation once without a PAYG debit", async () => {
    const repository = new BillingChargeReservationRepository(pool);
    const ledger = new PostgresBillingLedgerRepository(pool);
    await repository.reservePaygCredit({
      id: "reservation-failed-start",
      organizationId: "tenant-payg",
      reservationKey: "pstn:failed-start",
      catalogId: "catalog-2026-08-v1",
      chargeContext: byoChargeContext,
      amountMinor: 400,
      currency: "usd",
      expiresAt: "2026-08-10T10:05:00.000Z",
      now: "2026-08-10T10:00:00.000Z",
    });

    const first = await repository.releasePaygCredit({
      organizationId: "tenant-payg",
      reservationId: "reservation-failed-start",
      now: "2026-08-10T10:01:00.000Z",
    });
    const replay = await repository.releasePaygCredit({
      organizationId: "tenant-payg",
      reservationId: "reservation-failed-start",
      now: "2026-08-10T10:02:00.000Z",
    });

    expect({ first, replay }).toEqual({
      first: {
        outcome: "released",
        duplicate: false,
        releasedMinor: 400,
        availableMinor: 500,
      },
      replay: {
        outcome: "released",
        duplicate: true,
        releasedMinor: 400,
        availableMinor: 500,
      },
    });
    await expect(repository.listReservations("tenant-payg")).resolves.toEqual([
      expect.objectContaining({
        id: "reservation-failed-start",
        status: "released",
        releasedAt: "2026-08-10T10:01:00.000Z",
      }),
    ]);
    await expect(ledger.listPaygCreditEntries("tenant-payg")).resolves.toEqual([
      expect.objectContaining({ entryType: "grant", amountMinor: 500 }),
    ]);
  });
});
