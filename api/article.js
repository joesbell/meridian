import { getArticle, publicApiError } from "../server/feedApi.mjs";

export default async function handler(request, response) {
  try {
    const data = await getArticle(request.query.url || "", request.query.force === "1");
    response.setHeader("cache-control", "no-store");
    response.status(200).json(data);
  } catch (error) {
    const failure = publicApiError(error, "无法抓取并翻译原文正文");
    response.status(failure.status).json(failure.body);
  }
}
