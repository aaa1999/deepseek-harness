import { clientBundle } from '../../client/tsdown.client.ts'

/** Build the node-half lib plus the browser client bundle (Save/Fork dock). */
export default clientBundle(import.meta.dirname, ['lib/types/index.js'])
