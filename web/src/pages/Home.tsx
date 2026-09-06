import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Flame } from "../components/Flame";

export function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  function join(event: FormEvent) {
    event.preventDefault();
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    navigate(`/ouvir/${clean}`);
  }

  return (
    <div className="atmosphere">
      <section className="hero">
        <div className="hero-copy">
          <span className="brand">
            <Flame className="brand-mark" />
            Palavra
          </span>
          <h1>The voice of the service, on your phone.</h1>
          <p>
            Scan the booth QR. The translation arrives live — no app to install,
            just the browser.
          </p>
          <div className="cta-row">
            <Link className="btn" to="/como-usar">
              Open the space on this computer
            </Link>
          </div>
          <form className="join-panel field" onSubmit={join}>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Or enter the code"
              autoCapitalize="characters"
              aria-label="Space code"
            />
            <button className="btn btn-ghost" type="submit">
              Listen
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
