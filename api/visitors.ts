import { apiHandler } from '../server/http'
import { handleNewVisitor } from '../server/routes'

export default apiHandler(handleNewVisitor)