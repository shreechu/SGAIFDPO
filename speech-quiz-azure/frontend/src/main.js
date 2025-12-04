import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App";
import "./index.css";
import axios from "axios";
// Configure axios baseURL for production
const backendUrl = import.meta.env.VITE_API_BASE_URL || '';
if (backendUrl) {
    axios.defaults.baseURL = backendUrl;
    console.log('Configured axios baseURL:', backendUrl);
}
createRoot(document.getElementById("root")).render(_jsx(React.StrictMode, { children: _jsx(App, {}) }));
