import Link from 'next/link';
import { Wordmark } from '@/components/wordmark';

const STAGES = [
  { name: 'Manuscript', detail: 'DOCX, Markdown or text. Chapters split on import.' },
  { name: 'Passes', detail: 'Copyedit, proofread and structural. Accept or reject each change.' },
  { name: 'Compliance', detail: 'KDP AI disclosure answers built from your edit log. Rights checklist.' },
  { name: 'Listing', detail: 'Seven packed keyword boxes, category fit, royalty-aware pricing.' },
  { name: 'Export', detail: 'EPUB and print PDF for KDP or IngramSpark, with preflight.' },
  { name: 'Rank', detail: 'Daily keyword rank and BSR, tied to the listing version that was live.' },
  { name: 'Re-Optimize', detail: 'Keyword, category and price changes, scored by rank before and after.' },
];

const TOOLS = ['Quire', 'Publisher Rocket', 'Atticus', 'Vellum', 'Rank Trackers'] as const;
type Support = 'yes' | 'partial' | 'no';

const COMPARISON: Array<{ feature: string; support: Record<(typeof TOOLS)[number], Support> }> = [
  { feature: 'Editing Passes', support: { Quire: 'yes', 'Publisher Rocket': 'no', Atticus: 'no', Vellum: 'no', 'Rank Trackers': 'no' } },
  { feature: 'KDP AI Disclosure', support: { Quire: 'yes', 'Publisher Rocket': 'no', Atticus: 'no', Vellum: 'no', 'Rank Trackers': 'no' } },
  { feature: 'Packed Keyword Boxes', support: { Quire: 'yes', 'Publisher Rocket': 'partial', Atticus: 'no', Vellum: 'no', 'Rank Trackers': 'no' } },
  { feature: 'Category Fit', support: { Quire: 'yes', 'Publisher Rocket': 'yes', Atticus: 'no', Vellum: 'no', 'Rank Trackers': 'no' } },
  { feature: 'EPUB and Print PDF', support: { Quire: 'yes', 'Publisher Rocket': 'no', Atticus: 'yes', Vellum: 'yes', 'Rank Trackers': 'no' } },
  { feature: 'Keyword Rank Tracking', support: { Quire: 'yes', 'Publisher Rocket': 'no', Atticus: 'no', Vellum: 'no', 'Rank Trackers': 'yes' } },
  { feature: 'Change Attribution', support: { Quire: 'yes', 'Publisher Rocket': 'no', Atticus: 'no', Vellum: 'no', 'Rank Trackers': 'partial' } },
  { feature: 'Re-Optimize Recs', support: { Quire: 'yes', 'Publisher Rocket': 'no', Atticus: 'no', Vellum: 'no', 'Rank Trackers': 'no' } },
  { feature: 'Runs in the Browser', support: { Quire: 'yes', 'Publisher Rocket': 'no', Atticus: 'yes', Vellum: 'no', 'Rank Trackers': 'yes' } },
];

const SUPPORT_MARK: Record<Support, string> = { yes: '●', partial: '◐', no: '—' };
const SUPPORT_LABEL: Record<Support, string> = { yes: 'Yes', partial: 'Partial', no: 'No' };

const PLANS = [
  { name: 'Starter', price: '$0', books: '1 book', cap: '$1 AI spend a day', keywords: '25 tracked keywords' },
  { name: 'Author', price: '$19', books: '5 books', cap: '$5 AI spend a day', keywords: '150 tracked keywords per book' },
  { name: 'Press', price: '$49', books: '25 books', cap: '$20 AI spend a day', keywords: '500 tracked keywords per book' },
];

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-bar">
        <Wordmark />
        <nav className="btn-row" aria-label="Account">
          <Link className="btn btn-ghost" href="/login">
            Sign In
          </Link>
          <Link className="btn btn-primary" href="/signup">
            Start Free
          </Link>
        </nav>
      </header>

      <section className="hero">
        <p className="eyebrow">For Self-Published Authors</p>
        <h1>
          From finished draft to a <em>ranked</em> listing.
        </h1>
        <p className="hero-lede">Edit, disclose, list, export and track one book in one workspace. Each listing change is measured against the rank it produced.</p>
        <div className="btn-row">
          <Link className="btn btn-primary btn-large" href="/signup">
            Start Free
          </Link>
          <a className="btn btn-large" href="#compare">
            Compare Tools
          </a>
        </div>
      </section>

      <section className="pipeline" aria-label="Pipeline">
        <ol>
          {STAGES.map((stage, index) => (
            <li key={stage.name}>
              <span className="pipeline-num num">{String(index + 1).padStart(2, '0')}</span>
              <h3>{stage.name}</h3>
              <p>{stage.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section" id="compare">
        <div className="landing-head">
          <p className="eyebrow">Compare</p>
          <h2>How It Compares</h2>
        </div>
        <div className="table-wrap compare">
          <table className="table">
            <thead>
              <tr>
                <th />
                {TOOLS.map((tool) => (
                  <th key={tool} className={tool === 'Quire' ? 'compare-us' : undefined}>
                    {tool}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.feature}>
                  <th scope="row">{row.feature}</th>
                  {TOOLS.map((tool) => {
                    const support = row.support[tool];
                    return (
                      <td key={tool} className={`compare-cell ${support}${tool === 'Quire' ? ' compare-us' : ''}`} title={SUPPORT_LABEL[support]}>
                        <span aria-label={SUPPORT_LABEL[support]}>{SUPPORT_MARK[support]}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="landing-section" id="pricing">
        <div className="landing-head">
          <p className="eyebrow">Pricing</p>
          <h2>Priced Per Book</h2>
        </div>
        <div className="pricing">
          {PLANS.map((plan) => (
            <div key={plan.name} className="price-col">
              <h3>{plan.name}</h3>
              <p className="price num">
                {plan.price}
                <span>/mo</span>
              </p>
              <ul>
                <li>{plan.books}</li>
                <li>{plan.cap}</li>
                <li>{plan.keywords}</li>
              </ul>
            </div>
          ))}
        </div>
      </section>

      <footer className="landing-foot">
        <Wordmark />
        <span className="muted small">Not affiliated with Amazon KDP or IngramSpark.</span>
      </footer>
    </div>
  );
}
