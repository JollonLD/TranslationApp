import { Link } from "react-router-dom";
import { Flame } from "../components/Flame";

const steps = [
  {
    title: "Plug the mixer into the computer",
    text: "Use the mixer AUX, REC, or LINE OUT into the PC audio input. Chrome will hear that input as the microphone.",
  },
  {
    title: "Open the space and choose the spoken language",
    text: "The booth only chooses the voice: Portuguese, English, Spanish, Italian, Persian, or Urdu. Each person picks their reading language on the phone.",
  },
  {
    title: "Show the QR to the room",
    text: "People point their camera at the code and read the translation on their phone.",
  },
];

export function Onboarding() {
  return (
    <div className="atmosphere">
      <div className="shell">
        <span className="brand">
          <Flame className="brand-mark" />
          Chiesa Il Faro
        </span>
        <div className="steps">
          {steps.map((step, index) => (
            <div key={step.title}>
              <div className="step-num">0{index + 1}</div>
              <h2 className="display" style={{ fontSize: "2.2rem", margin: "8px 0" }}>
                {step.title}
              </h2>
              <p className="original">{step.text}</p>
            </div>
          ))}
          <Link className="btn" to="/espaco?pronto=1">
            Got it, open the space
          </Link>
        </div>
      </div>
    </div>
  );
}
