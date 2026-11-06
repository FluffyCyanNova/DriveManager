import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { queryClient as qc } from "./services/queryClient";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><QueryClientProvider client={qc}><BrowserRouter><App /></BrowserRouter></QueryClientProvider></React.StrictMode>,
);
