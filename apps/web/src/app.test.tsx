import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("tenant dashboard shell", () => {
  it("renders authenticated tenant navigation and the dashboard route", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    expect(html).toContain('aria-label="Tenant"');
    expect(html).toContain(">Agents<");
    expect(html).toContain(">Workflows<");
    expect(html).toContain(">Sandbox<");
    expect(html).toContain(">Calls<");
    expect(html).toContain(">Operations<");
  });
});
