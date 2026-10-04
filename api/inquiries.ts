import { apiHandler } from '../server/http'
import { handleNewInquiry } from '../server/routes'

export default apiHandler((request, response) => handleNewInquiry(request, response))