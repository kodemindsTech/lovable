import { Link } from "react-router-dom";

const DRAFT = "DRAFT — placeholder text pending legal review. Not the final policy.";

export function Privacy() {
  return (
    <article className="card auth">
      <p className="warn">{DRAFT}</p>
      <h1>Privacy</h1>
      <p>We collect only what is needed to calculate your targets and show your progress: profile details (age, sex, height, weight), goals, and the food, water and other fitness data you log.</p>
      <p>This is health-related data. We process it only with your consent, to provide the app. You can export or permanently delete it at any time in Settings.</p>
      <p>AI features are not enabled yet. When they are, you will be told what data is sent and why before anything is shared.</p>
      <Link to="/">Back</Link>
    </article>
  );
}

export function Terms() {
  return (
    <article className="card auth">
      <p className="warn">{DRAFT}</p>
      <h1>Terms</h1>
      <p>This app provides general fitness information and is not medical advice. It does not diagnose, treat or prevent any condition. Consult a doctor before changing your diet or exercise, especially if you have a health condition.</p>
      <p>You must be 18 or older to use it. Nutrition values are approximate and some are estimates; always check labels where accuracy matters.</p>
      <Link to="/">Back</Link>
    </article>
  );
}
