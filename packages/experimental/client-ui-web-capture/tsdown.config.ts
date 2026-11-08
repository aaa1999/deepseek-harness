/** Bundle the web-capture relay client. */
import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(import.meta.dirname, ['lib/types/index.js'])
