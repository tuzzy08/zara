import request from "supertest";import { afterEach, describe, expect, it, vi } from "vitest";import { connectIntegration, createTestingApp, jsonResponse } from "./connector-tools.contract.test-support";

describe("connector provider contracts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("executes Shopify read-only commerce lookups through curated Admin GraphQL contracts", async () => {
    const app = await createTestingApp();
    const connectionId = await connectIntegration(
      app,
      "shopify",
      ["read_customers", "read_orders", "read_fulfillments"],
      { shopDomain: "tuzzy-store.myshopify.com" },
    );
    const accessToken = "shopify:access:shopify-oauth-code-contract";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            customers: {
              edges: [
                {
                  node: {
                    id: "gid://shopify/Customer/1001",
                    displayName: "Ada Lovelace",
                    email: "ada@example.com",
                    phone: "+15551234567",
                  },
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            orders: {
              edges: [
                {
                  node: {
                    id: "gid://shopify/Order/2001",
                    name: "#1001",
                    email: "ada@example.com",
                    displayFinancialStatus: "PAID",
                    displayFulfillmentStatus: "FULFILLED",
                    processedAt: "2026-06-06T09:30:00Z",
                    customer: {
                      id: "gid://shopify/Customer/1001",
                      email: "ada@example.com",
                    },
                  },
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            order: {
              id: "gid://shopify/Order/2001",
              name: "#1001",
              fulfillments: [
                {
                  id: "gid://shopify/Fulfillment/3001",
                  status: "SUCCESS",
                  trackingInfo: [
                    {
                      number: "1Z999",
                      company: "UPS",
                      url: "https://track.example.test/1Z999",
                    },
                  ],
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            orders: {
              edges: [
                {
                  node: {
                    id: "gid://shopify/Order/2001",
                    name: "#1001",
                    displayFulfillmentStatus: "IN_TRANSIT",
                    fulfillments: [
                      {
                        id: "gid://shopify/Fulfillment/3001",
                        status: "SUCCESS",
                        trackingInfo: [
                          {
                            number: "1Z999",
                            company: "UPS",
                            url: "https://track.example.test/1Z999",
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(429, { errors: [{ message: "Throttled" }] }, { "retry-after": "25" }));
    vi.stubGlobal("fetch", fetchMock);

    const schemasResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/shopify/tools",
    );

    expect(schemasResponse.status).toBe(200);
    expect(schemasResponse.body.tools.map((tool: { toolId: string }) => tool.toolId)).toEqual([
      "shopify.customers.lookup",
      "shopify.orders.lookup",
      "shopify.fulfillments.lookup",
      "shopify.shipping_status.lookup",
    ]);
    expect(JSON.stringify(schemasResponse.body)).not.toMatch(/refund|cancel|address|draft|discount|inventory|mutation/i);

    const customerResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/shopify/tools/shopify.customers.lookup/execute")
      .send({
        connectionId,
        input: {
          email: "ada@example.com",
        },
      });

    expect(customerResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://tuzzy-store.myshopify.com/admin/api/2026-04/graphql.json",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Shopify-Access-Token": accessToken,
          "content-type": "application/json",
          accept: "application/json",
        }),
        body: expect.stringContaining("customers(first: 2, query: $query)"),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      variables: {
        query: "email:ada@example.com",
      },
    });
    expect(customerResponse.body.result).toEqual({
      provider: "shopify",
      toolId: "shopify.customers.lookup",
      customers: [
        {
          id: "gid://shopify/Customer/1001",
          name: "Ada Lovelace",
          email: "ada@example.com",
          phone: "+15551234567",
        },
      ],
    });

    const orderResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/shopify/tools/shopify.orders.lookup/execute")
      .send({
        connectionId,
        input: {
          orderName: "#1001",
          customerEmail: "ada@example.com",
        },
      });

    expect(orderResponse.status).toBe(201);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      variables: {
        query: "name:#1001 email:ada@example.com",
      },
    });
    expect(orderResponse.body.result).toEqual({
      provider: "shopify",
      toolId: "shopify.orders.lookup",
      orders: [
        {
          id: "gid://shopify/Order/2001",
          name: "#1001",
          customerId: "gid://shopify/Customer/1001",
          customerEmail: "ada@example.com",
          financialStatus: "PAID",
          fulfillmentStatus: "FULFILLED",
          processedAt: "2026-06-06T09:30:00Z",
        },
      ],
    });

    const fulfillmentsResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/shopify/tools/shopify.fulfillments.lookup/execute")
      .send({
        connectionId,
        input: {
          orderId: "gid://shopify/Order/2001",
        },
      });

    expect(fulfillmentsResponse.status).toBe(201);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      variables: {
        orderId: "gid://shopify/Order/2001",
      },
    });
    expect(fulfillmentsResponse.body.result).toEqual({
      provider: "shopify",
      toolId: "shopify.fulfillments.lookup",
      order: {
        id: "gid://shopify/Order/2001",
        name: "#1001",
      },
      fulfillments: [
        {
          id: "gid://shopify/Fulfillment/3001",
          status: "SUCCESS",
          tracking: [
            {
              number: "1Z999",
              company: "UPS",
              url: "https://track.example.test/1Z999",
            },
          ],
        },
      ],
    });

    const shippingResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/shopify/tools/shopify.shipping_status.lookup/execute")
      .send({
        connectionId,
        input: {
          orderName: "#1001",
          customerEmail: "ada@example.com",
        },
      });

    expect(shippingResponse.status).toBe(201);
    expect(shippingResponse.body.result).toEqual({
      provider: "shopify",
      toolId: "shopify.shipping_status.lookup",
      shippingStatus: {
        orderId: "gid://shopify/Order/2001",
        orderName: "#1001",
        fulfillmentStatus: "IN_TRANSIT",
        tracking: [
          {
            number: "1Z999",
            company: "UPS",
            url: "https://track.example.test/1Z999",
          },
        ],
      },
    });

    const rateLimitResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/shopify/tools/shopify.customers.lookup/execute")
      .send({
        connectionId,
        input: {
          email: "ada@example.com",
        },
      });

    expect(rateLimitResponse.status).toBe(429);
    expect(rateLimitResponse.body).toMatchObject({
      provider: "shopify",
      toolId: "shopify.customers.lookup",
      code: "tool_execution.rate_limited",
      recoverable: true,
      retryAfterSeconds: 25,
    });
    expect(JSON.stringify(rateLimitResponse.body)).not.toContain(accessToken);
    expect(JSON.stringify(customerResponse.body)).not.toContain(accessToken);

    await app.close();
  }, 15_000);

  it("executes Stripe read-only billing lookups through curated REST contracts", async () => {
    const app = await createTestingApp();
    const connectionId = await connectIntegration(
      app,
      "stripe",
      ["read_only"],
    );
    const accessToken = "stripe:access:stripe-oauth-code-contract";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          object: "search_result",
          data: [
            {
              id: "cus_123",
              object: "customer",
              name: "Ada Lovelace",
              email: "ada@example.com",
              phone: "+15551234567",
              delinquent: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          object: "list",
          data: [
            {
              id: "sub_123",
              object: "subscription",
              customer: "cus_123",
              status: "active",
              current_period_end: 1780819200,
              cancel_at_period_end: false,
              items: {
                data: [
                  {
                    price: {
                      id: "price_support",
                      nickname: "Support plan",
                    },
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: "in_123",
          object: "invoice",
          customer: "cus_123",
          number: "INV-1001",
          status: "paid",
          amount_due: 2500,
          amount_paid: 2500,
          currency: "usd",
          hosted_invoice_url: "https://invoice.stripe.test/in_123",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: "pi_123",
          object: "payment_intent",
          customer: "cus_123",
          status: "succeeded",
          amount: 2500,
          currency: "usd",
          latest_charge: {
            id: "ch_123",
            outcome: {
              type: "authorized",
              seller_message: "Payment complete.",
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: "Too many requests" } }, { "retry-after": "17" }));
    vi.stubGlobal("fetch", fetchMock);

    const schemasResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/stripe/tools",
    );

    expect(schemasResponse.status).toBe(200);
    expect(schemasResponse.body.tools.map((tool: { toolId: string }) => tool.toolId)).toEqual([
      "stripe.customers.lookup",
      "stripe.subscriptions.lookup",
      "stripe.invoices.lookup",
      "stripe.payment_status.lookup",
    ]);
    expect(JSON.stringify(schemasResponse.body)).not.toMatch(/refund|cancel|payment.?method|invoice.?create|coupon|retry|\.create|\.update|\.delete/i);

    const customerResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/stripe/tools/stripe.customers.lookup/execute")
      .send({
        connectionId,
        input: {
          email: "ada@example.com",
        },
      });

    expect(customerResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.stripe.com/v1/customers/search?query=email%3A%27ada%40example.com%27&limit=3",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        }),
      }),
    );
    expect(customerResponse.body.result).toEqual({
      provider: "stripe",
      toolId: "stripe.customers.lookup",
      customers: [
        {
          id: "cus_123",
          name: "Ada Lovelace",
          email: "ada@example.com",
          phone: "+15551234567",
          delinquent: false,
        },
      ],
    });

    const subscriptionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/stripe/tools/stripe.subscriptions.lookup/execute")
      .send({
        connectionId,
        input: {
          customerId: "cus_123",
        },
      });

    expect(subscriptionResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.stripe.com/v1/subscriptions?customer=cus_123&status=all&limit=10",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(subscriptionResponse.body.result).toEqual({
      provider: "stripe",
      toolId: "stripe.subscriptions.lookup",
      subscriptions: [
        {
          id: "sub_123",
          customerId: "cus_123",
          status: "active",
          currentPeriodEnd: "2026-06-07T08:00:00.000Z",
          cancelAtPeriodEnd: false,
          items: [
            {
              priceId: "price_support",
              nickname: "Support plan",
            },
          ],
        },
      ],
    });

    const invoiceResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/stripe/tools/stripe.invoices.lookup/execute")
      .send({
        connectionId,
        input: {
          invoiceId: "in_123",
        },
      });

    expect(invoiceResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.stripe.com/v1/invoices/in_123",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(invoiceResponse.body.result).toEqual({
      provider: "stripe",
      toolId: "stripe.invoices.lookup",
      invoice: {
        id: "in_123",
        customerId: "cus_123",
        number: "INV-1001",
        status: "paid",
        amountDue: 2500,
        amountPaid: 2500,
        currency: "usd",
        hostedInvoiceUrl: "https://invoice.stripe.test/in_123",
      },
    });

    const paymentStatusResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/stripe/tools/stripe.payment_status.lookup/execute")
      .send({
        connectionId,
        input: {
          paymentIntentId: "pi_123",
        },
      });

    expect(paymentStatusResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://api.stripe.com/v1/payment_intents/pi_123?expand%5B%5D=latest_charge",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(paymentStatusResponse.body.result).toEqual({
      provider: "stripe",
      toolId: "stripe.payment_status.lookup",
      paymentStatus: {
        id: "pi_123",
        customerId: "cus_123",
        status: "succeeded",
        amount: 2500,
        currency: "usd",
        latestChargeId: "ch_123",
        outcomeType: "authorized",
        sellerMessage: "Payment complete.",
      },
    });

    const rateLimitResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/stripe/tools/stripe.customers.lookup/execute")
      .send({
        connectionId,
        input: {
          email: "ada@example.com",
        },
      });

    expect(rateLimitResponse.status).toBe(429);
    expect(rateLimitResponse.body).toMatchObject({
      provider: "stripe",
      toolId: "stripe.customers.lookup",
      code: "tool_execution.rate_limited",
      recoverable: true,
      retryAfterSeconds: 17,
    });
    expect(JSON.stringify(rateLimitResponse.body)).not.toContain(accessToken);
    expect(JSON.stringify(customerResponse.body)).not.toContain(accessToken);

    await app.close();
  }, 15_000);
});
