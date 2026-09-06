import { Navigate, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { Listen } from "./pages/Listen";
import { Onboarding } from "./pages/Onboarding";
import { Space } from "./pages/Space";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/como-usar" element={<Onboarding />} />
      <Route path="/espaco" element={<Space />} />
      <Route path="/ouvir" element={<Listen />} />
      <Route path="/ouvir/:code" element={<Listen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
