// --- STATE MANAGEMENT ---
const API_BASE_URL = "http://localhost:3000/api";
let TOKEN = null;
let CURRENT_USER = null;

// --- DOM ELEMENTS ---
const loginView = document.getElementById("login-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

const userInfo = document.getElementById("user-info");
const userFullname = document.getElementById("user-fullname");
const logoutButton = document.getElementById("logout-button");

const customerDashboard = document.getElementById("customer-dashboard");
const mechanicDashboard = document.getElementById("mechanic-dashboard");
const adminDashboard = document.getElementById("admin-dashboard");

const customerStatusList = document.getElementById("customer-status-list");
const customerRequestForm = document.getElementById("customer-request-form");
const customerRequestSuccess = document.getElementById(
  "customer-request-success"
);

const mechanicJobList = document.getElementById("mechanic-job-list");

const adminJobList = document.getElementById("admin-job-list");
const adminPartsList = document.getElementById("admin-parts-list");

// --- MODAL ELEMENTS ---
const logPartModal = document.getElementById("log-part-modal");
const closeModalButton = document.getElementById("close-modal");
const logPartForm = document.getElementById("log-part-form");
const modalJobIdSpan = document.getElementById("modal-job-id");
const modalJobIdInput = document.getElementById("modal-job-id-input");
const partSelect = document.getElementById("part-select");
const logPartError = document.getElementById("log-part-error");

// --- API HELPER FUNCTION ---
/**
 * A helper function to make authenticated API requests.
 * @param {string} endpoint - The API endpoint (e.g., '/customer/status')
 * @param {string} method - HTTP method (GET, POST, PUT)
 * @param {object} [body] - Optional data to send in the request body
 * @returns {Promise<object>} The JSON response
 */
async function apiRequest(endpoint, method, body = null) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (TOKEN) {
    headers["Authorization"] = `Bearer ${TOKEN}`;
  }

  const config = {
    method,
    headers,
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        errorData.message || `HTTP error! Status: ${response.status}`
      );
    }

    // Handle no-content responses (e.g., 204)
    if (response.status === 204) {
      return {};
    }

    return await response.json();
  } catch (error) {
    console.error("API Request Error:", error.message);
    throw error;
  }
}

// --- LOGIN & LOGOUT ---
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  try {
    const data = await apiRequest("/auth/login", "POST", {
      username,
      password,
    });
    TOKEN = data.token;
    CURRENT_USER = data.user;
    localStorage.setItem("token", TOKEN);
    localStorage.setItem("user", JSON.stringify(CURRENT_USER));

    showDashboard(CURRENT_USER.role);
  } catch (error) {
    loginError.textContent = `Login Failed: ${error.message}`;
  }
});

logoutButton.addEventListener("click", () => {
  TOKEN = null;
  CURRENT_USER = null;
  localStorage.removeItem("token");
  localStorage.removeItem("user");

  // Hide all dashboards and user info
  [customerDashboard, mechanicDashboard, adminDashboard, userInfo].forEach(
    (el) => el.classList.add("hidden")
  );

  // Show login form
  loginView.classList.remove("hidden");
});

// --- DASHBOARD ROUTING ---
function showDashboard(role) {
  // Hide login and all dashboards
  loginView.classList.add("hidden");
  [customerDashboard, mechanicDashboard, adminDashboard].forEach((el) =>
    el.classList.add("hidden")
  );

  // Show user info
  userFullname.textContent = CURRENT_USER.fullName;
  userInfo.classList.remove("hidden");

  // Show the correct dashboard based on role
  if (role === "customer") {
    customerDashboard.classList.remove("hidden");
    loadCustomerDashboard();
  } else if (role === "mechanic") {
    mechanicDashboard.classList.remove("hidden");
    loadMechanicDashboard();
  } else if (role === "admin") {
    adminDashboard.classList.remove("hidden");
    loadAdminDashboard();
  }
}

// --- CUSTOMER DASHBOARD ---
async function loadCustomerDashboard() {
  customerStatusList.innerHTML = "Loading...";
  try {
    const jobs = await apiRequest("/customer/status", "GET");

    if (jobs.length === 0) {
      customerStatusList.innerHTML =
        "<p>You have no active service requests.</p>";
      return;
    }

    customerStatusList.innerHTML = ""; // Clear loading
    jobs.forEach((job) => {
      const statusClass = `status-${job.status.split(" ")[0]}`; // e.g., "status-Ready"
      customerStatusList.innerHTML += `
                <div class="job-card">
                    <h4>Vehicle: ${job.vehicle}</h4>
                    <p><strong>Issue:</strong> ${job.issue}</p>
                    <p><strong>Status:</strong> <span class="status ${statusClass}">${
        job.status
      }</span></p>
                    <p><small>Submitted: ${new Date(
                      job.created
                    ).toLocaleString()}</small></p>
                </div>
            `;
    });
  } catch (error) {
    customerStatusList.innerHTML = `<p class="error-message">Error: ${error.message}</p>`;
  }
}

customerRequestForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  customerRequestSuccess.textContent = "";
  const vehicleNumberPlate = document.getElementById("vehicle-plate").value;
  const issueDescription = document.getElementById("issue-description").value;

  try {
    await apiRequest("/customer/request-service", "POST", {
      vehicleNumberPlate,
      issueDescription,
    });
    customerRequestSuccess.textContent =
      "Service request submitted successfully!";
    customerRequestForm.reset();
    loadCustomerDashboard(); // Refresh the list
  } catch (error) {
    customerRequestSuccess.textContent = `Error: ${error.message}`;
  }
});

// --- MECHANIC DASHBOARD ---
async function loadMechanicDashboard() {
  mechanicJobList.innerHTML = "Loading...";

  try {
    const [jobs, parts] = await Promise.all([
      apiRequest("/mechanic/jobs", "GET"),
      apiRequest("/inventory/parts", "GET"),
    ]);

    // Populate parts dropdown for the modal
    partSelect.innerHTML = parts
      .map(
        (p) =>
          `<option value="${p.id}">${p.partName} (In Stock: ${p.quantity})</option>`
      )
      .join("");

    if (jobs.length === 0) {
      mechanicJobList.innerHTML = "<p>You have no assigned jobs.</p>";
      return;
    }

    mechanicJobList.innerHTML = "";
    jobs.forEach((job) => {
      mechanicJobList.appendChild(createMechanicJobCard(job));
    });
  } catch (error) {
    mechanicJobList.innerHTML = `<p class="error-message">Error: ${error.message}</p>`;
  }
}

function createMechanicJobCard(job) {
  const card = document.createElement("div");
  card.className = "job-card";
  const statusClass = `status-${job.status.split(" ")[0]}`;

  card.innerHTML = `
        <h4>Vehicle: ${job.vehicleNumberPlate} (Job ID: ${job.id})</h4>
        <p><strong>Customer:</strong> ${job.customerName} (${
    job.customerMobile
  })</p>
        <p><strong>Issue:</strong> ${job.issueDescription}</p>
        <p><strong>Status:</strong> <span class="status ${statusClass}">${
    job.status
  }</span></p>
        <div class="parts-log">
            <strong>Parts Used:</strong>
            <ul>
                ${
                  job.partsUsed.length > 0
                    ? job.partsUsed
                        .map((p) => `<li>${p.quantity} x ${p.partName}</li>`)
                        .join("")
                    : "<li>None</li>"
                }
            </ul>
        </div>
        <div class="job-actions">
            <select class="update-status-select" data-job-id="${job.id}">
                <option value="">-- Update Status --</option>
                <option value="In Progress" ${
                  job.status === "In Progress" ? "selected" : ""
                }>In Progress</option>
                <option value="Ready for Dispatch" ${
                  job.status === "Ready for Dispatch" ? "selected" : ""
                }>Ready for Dispatch</option>
                <option value="Dispatched" ${
                  job.status === "Dispatched" ? "selected" : ""
                }>Dispatched</option>
            </select>
            <button class="log-part-button secondary" data-job-id="${
              job.id
            }">Log Part</button>
        </div>
    `;

  // Event Listener for status change
  card
    .querySelector(".update-status-select")
    .addEventListener("change", async (e) => {
      const newStatus = e.target.value;
      if (!newStatus) return;

      try {
        await apiRequest(`/mechanic/jobs/${job.id}/status`, "PUT", {
          status: newStatus,
        });
        loadMechanicDashboard(); // Refresh
      } catch (error) {
        alert(`Error updating status: ${error.message}`);
      }
    });

  // Event Listener for log part button
  card.querySelector(".log-part-button").addEventListener("click", () => {
    openLogPartModal(job.id);
  });

  return card;
}

// --- Mechanic Modal Logic ---
function openLogPartModal(jobId) {
  modalJobIdSpan.textContent = jobId;
  modalJobIdInput.value = jobId;
  logPartError.textContent = "";
  logPartModal.classList.remove("hidden");
}

closeModalButton.addEventListener("click", () => {
  logPartModal.classList.add("hidden");
});

logPartForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  logPartError.textContent = "";
  const jobId = modalJobIdInput.value;
  const partId = document.getElementById("part-select").value;
  const quantityUsed = document.getElementById("part-quantity").value;

  try {
    await apiRequest(`/mechanic/jobs/${jobId}/log-part`, "PUT", {
      partId,
      quantityUsed,
    });
    logPartModal.classList.add("hidden");
    loadMechanicDashboard(); // Refresh job list
  } catch (error) {
    logPartError.textContent = `Error: ${error.message}`;
  }
});

// --- ADMIN DASHBOARD ---
let adminData = {
  jobs: [],
  mechanics: [],
  parts: [],
};

async function loadAdminDashboard() {
  adminJobList.innerHTML = "Loading...";
  adminPartsList.innerHTML = "Loading...";

  try {
    const data = await apiRequest("/admin/dashboard-data", "GET");
    adminData.jobs = data.jobCards;
    adminData.mechanics = data.mechanics;
    adminData.parts = data.parts;

    // Render Jobs
    if (adminData.jobs.length === 0) {
      adminJobList.innerHTML = "<p>No job cards found.</p>";
    } else {
      adminJobList.innerHTML = "";
      adminData.jobs.forEach((job) => {
        adminJobList.appendChild(createAdminJobCard(job));
      });
    }

    // Render Parts
    if (adminData.parts.length === 0) {
      adminPartsList.innerHTML = "<p>No parts in inventory.</p>";
    } else {
      adminPartsList.innerHTML = "<ul>";
      adminData.parts.forEach((part) => {
        adminPartsList.innerHTML += `<li><strong>${part.partName}:</strong> ${part.quantity} in stock</li>`;
      });
      adminPartsList.innerHTML += "</ul>";
    }
  } catch (error) {
    adminJobList.innerHTML = `<p class="error-message">Error: ${error.message}</p>`;
  }
}

function createAdminJobCard(job) {
  const card = document.createElement("div");
  card.className = "job-card";
  const statusClass = `status-${job.status.split(" ")[0]}`;

  // Create dropdown for mechanic assignment
  const mechanicOptions = adminData.mechanics
    .map(
      (m) =>
        `<option value="${m.id}" ${
          job.assignedMechanicId === m.id ? "selected" : ""
        }>${m.fullName}</option>`
    )
    .join("");

  card.innerHTML = `
        <h4>Vehicle: ${job.vehicleNumberPlate} (Job ID: ${job.id})</h4>
        <p><strong>Customer:</strong> ${job.customerName}</p>
        <p><strong>Issue:</strong> ${job.issueDescription}</p>
        <p><strong>Status:</strong> <span class="status ${statusClass}">${
    job.status
  }</span></p>
        <div class="parts-log">
            <strong>Parts Used:</strong>
            <ul>
                ${
                  job.partsUsed.length > 0
                    ? job.partsUsed
                        .map((p) => `<li>${p.quantity} x ${p.partName}</li>`)
                        .join("")
                    : "<li>None</li>"
                }
            </ul>
        </div>
        <div class="job-actions">
            <label for="assign-mech-${job.id}">Assign Mechanic:</label>
            <select id="assign-mech-${
              job.id
            }" class="assign-mechanic-select" data-job-id="${job.id}">
                <option value="">-- Unassigned --</option>
                ${mechanicOptions}
            </select>
        </div>
    `;

  // Event Listener for mechanic assignment
  card
    .querySelector(".assign-mechanic-select")
    .addEventListener("change", async (e) => {
      const mechanicId = e.target.value;
      if (!mechanicId) return; // Maybe add un-assign logic later

      try {
        // We call the API and get the *updated* job back
        const { jobCard: updatedJob } = await apiRequest(
          `/admin/jobcards/${job.id}/assign`,
          "PUT",
          { mechanicId }
        );

        // We can just refresh the whole dashboard, or be smart and update
        // the single card. Let's refresh for simplicity.
        loadAdminDashboard();
      } catch (error) {
        alert(`Error assigning mechanic: ${error.message}`);
      }
    });

  return card;
}

// --- INITIAL APP LOAD ---
function initApp() {
  const storedToken = localStorage.getItem("token");
  const storedUser = localStorage.getItem("user");

  if (storedToken && storedUser) {
    TOKEN = storedToken;
    CURRENT_USER = JSON.parse(storedUser);
    showDashboard(CURRENT_USER.role);
  } else {
    loginView.classList.remove("hidden");
  }
}

// Run the app
initApp();
