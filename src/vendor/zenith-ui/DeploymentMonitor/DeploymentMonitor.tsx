import './DeploymentMonitor.css'

export type DeploymentItem = { name: string; detail: string; state: 'ready' | 'blocked' | 'unknown' | 'pending'; label: string }
export type DeploymentAction = { id: string; label: string; disabled?: boolean }
export interface DeploymentMonitorProps {
  title: string
  subtitle: string
  profile: string
  connection: string
  items: DeploymentItem[]
  checkpoints: DeploymentItem[]
  actions: DeploymentAction[]
  busy?: boolean
  message?: string
  review?: { title: string; detail: string; destination: string; digest: string }
  onAction: (action: string) => void
}

/** Presentation only. Hosts supply observed state and own every privileged action. */
export function DeploymentMonitor(props: DeploymentMonitorProps) {
  return <main className="zn-deployment">
    <aside className="zn-deployment__rail" aria-label="Workspace">
      <div className="zn-deployment__mark" aria-label="Zenith">Z</div>
      <span className="zn-deployment__rail-label">Environment</span>
      <span className="zn-deployment__rail-current">Overview</span>
      <span className="zn-deployment__rail-note">Local operator</span>
    </aside>
    <div className="zn-deployment__workspace">
      <header className="zn-deployment__header"><span>ZENITH / HUB</span><span>{props.connection}</span></header>
      <section className="zn-deployment__intro">
        <div><p className="zn-deployment__eyebrow">DEPLOY & MONITOR</p><h1>{props.title}</h1><p>{props.subtitle}</p></div>
        <span className="zn-deployment__profile">{props.profile}</span>
      </section>
      <section className="zn-deployment__section" aria-labelledby="deployment-components">
        <div className="zn-deployment__section-heading"><h2 id="deployment-components">Your components</h2><span>Observed on this host</span></div>
        <div className="zn-deployment__components">{props.items.map(item => <article className="zn-deployment__component" key={item.name}>
          <div className="zn-deployment__item-heading"><h3>{item.name}</h3><span className={`zn-deployment__state zn-deployment__state--${item.state}`}>{item.label}</span></div>
          <p>{item.detail}</p>
        </article>)}</div>
      </section>
      <section className="zn-deployment__section" aria-labelledby="deployment-path">
        <div className="zn-deployment__section-heading"><h2 id="deployment-path">Path to your first request</h2><span>Installation and readiness are separate</span></div>
        <ol className="zn-deployment__path">{props.checkpoints.map((item,i) => <li key={item.name}>
          <span className="zn-deployment__number">{String(i+1).padStart(2,'0')}</span><div><h3>{item.name}</h3><p>{item.detail}</p></div><span className={`zn-deployment__state zn-deployment__state--${item.state}`}>{item.label}</span>
        </li>)}</ol>
      </section>
      <section className="zn-deployment__operations" aria-label="Environment controls">
        <div><h2>Manage this installation</h2><p>Review an action before applying it. Data and credentials stay on your Mac.</p></div>
        <div className="zn-deployment__buttons">{props.actions.map(action => <button key={action.id} type="button" disabled={props.busy || action.disabled} onClick={() => props.onAction(action.id)}>{action.label}</button>)}</div>
      </section>
      {props.review && <section className="zn-deployment__review" aria-label="Review deployment action"><h2>{props.review.title}</h2><p>{props.review.detail}</p><dl><dt>Destination</dt><dd>{props.review.destination}</dd><dt>Release manifest</dt><dd>{props.review.digest}</dd></dl><div className="zn-deployment__buttons"><button disabled={props.busy} onClick={() => props.onAction('apply')}>Apply reviewed action</button><button disabled={props.busy} onClick={() => props.onAction('cancel')}>Cancel</button></div></section>}
      <p className="zn-deployment__message" role="status" aria-live="polite">{props.message || 'No action has been requested.'}</p>
      <footer className="zn-deployment__footer"><span>Service owns requests. Runtime owns execution. Frank does the work.</span><span>Local Mac profile</span></footer>
    </div>
  </main>
}
