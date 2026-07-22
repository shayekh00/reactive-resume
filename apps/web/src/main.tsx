import { Buffer } from "buffer";
import { RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";
import { getRouter } from "./router";
import "./index.css";

// react-pdf's browser dependencies (pdfkit/fontkit) expect a global Buffer, which the
// browser does not provide. Polyfill it so client-side PDF preview and export work.
globalThis.Buffer ??= Buffer;

const rootElement = document.getElementById("app");
if (!rootElement) throw new Error("Root element not found");

const router = await getRouter();

if (!rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);

	root.render(<RouterProvider router={router} />);
}
