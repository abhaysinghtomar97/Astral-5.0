import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import "./index.css";
import Astral from "./Astral.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Astral />
    <Analytics />
  </StrictMode>
);