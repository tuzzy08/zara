import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { PlatformAdminApp } from "./index";
import "./styles.css";

const root = document.getElementById("root");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <PlatformAdminApp />
    </StrictMode>,
  );
}
