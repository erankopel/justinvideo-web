import { render } from 'preact'
import { App } from './app'
import { Offline } from './offline/register'
import { startServices } from './services'
import './styles.css'

// The service worker that lets the site open without a connection exists only in the build that is published.
const offline = new Offline()
if (import.meta.env.PROD) offline.start()

const root = document.getElementById('app')
if (root) {
  const started = await startServices()
  render('services' in started ? <App services={started.services} blocked={null} offline={offline} /> : <App services={null} blocked={started.blocked} offline={offline} />, root)
}
