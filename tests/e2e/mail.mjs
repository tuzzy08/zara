import { createServer } from "node:http";

// Only the email provider is replaced. Auth creates and validates real tokens.
const messages = [];
createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/messages") {
    let body = "";
    for await (const chunk of request) body += chunk;
    messages.push(JSON.parse(body));
    response.writeHead(204).end();
    return;
  }
  const url = new URL(request.url, "http://mail");
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(messages.filter((message) => message.to === url.searchParams.get("to"))));
}).listen(8025, "0.0.0.0");
