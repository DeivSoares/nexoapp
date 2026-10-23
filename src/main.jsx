import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Login from "./Login.jsx";
import "../app.css";
import "../login.css";

const Page = window.location.pathname.endsWith("/login.html") ? Login : App;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {Page === Login ? <div className="login-page"><Login /></div> : <App />}
  </React.StrictMode>,
);
