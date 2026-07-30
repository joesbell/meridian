import { getNews, publicApiError } from "../server/feedApi.mjs";

export default async function handler(request, response) {
  try {
    const data = await getNews(request.query.force === "1");
    response.setHeader("cache-control", "no-store");
    response.status(200).json(data);
  } catch (error) {
    const failure = publicApiError(error, "无法读取最新新闻");
    response.status(failure.status).json(failure.body);
  }
}
