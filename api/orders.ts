import { apiHandler } from '../server/http'
import { handleNewOrder } from '../server/routes'

export default apiHandler(handleNewOrder)