
  import './i18n';
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./styles/index.css";
  import { captureInstallPrompt } from "./app/lib/installPrompt";

  captureInstallPrompt();
  createRoot(document.getElementById("root")!).render(<App />);
  