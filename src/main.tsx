import React from "react";
import ReactDOM from "react-dom/client";
import { Island } from "./components/Island";
import { Picker } from "./components/Picker";
import "./styles.css";

// The same page serves two windows: the island, and the colour picker overlay.
const isPicker = window.location.hash === "#picker";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isPicker ? <Picker /> : <Island />}</React.StrictMode>,
);
