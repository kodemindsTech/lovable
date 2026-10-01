export default function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="muted">Planned for {phase}. Nothing to show yet.</p>
    </>
  );
}
