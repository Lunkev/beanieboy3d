import { createRoot } from "react-dom/client";
// grundstil först — formatens egen CSS (importeras av formaten) och brand.css ska kunna skriva över den
import "./styles/app.css";
import "./styles/skin-nintendo.css";
import App from "./App";
import "./styles/brand.css";

createRoot(document.getElementById("root")!).render(<App />);
