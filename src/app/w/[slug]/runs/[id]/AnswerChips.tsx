"use client";
/** Quick answers: a click adds the line to the decision comment (DecisionPanel listens to «office:answer»). */
export function AnswerChips({ area, answers }: { area: string; answers: string[] }) {
  return (
    <div className="chips">
      {answers.map((a, i) => (
        <button key={i} type="button" className="chip" title={a}
          onClick={() => window.dispatchEvent(new CustomEvent("office:answer", { detail: `${area}: ${a}` }))}>
          {i === 0 ? "✓ " : "+ "}{a}
        </button>
      ))}
    </div>
  );
}
