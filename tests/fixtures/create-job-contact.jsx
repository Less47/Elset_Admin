import { useState } from "react";
import { createRoot } from "react-dom/client";
import CreateJobPage from "../../src/components/jobs/CreateJobPage.jsx";
import { UnsavedChangesContext } from "../../src/components/workspace/unsaved-changes-context.js";

const initialCustomers = [{
  id: "contact-customer", name: "Contact Regression Customer", address: "1 Existing Street, Melbourne VIC 3000",
  contacts: [
    { id: "contact-a", name: "John Smith", role: "Caretaker", phone: "0400 000 111" },
    { id: "contact-b", name: "Mary Jane Brown", role: "Reception", phone: "0400 000 222" },
  ],
  sites: [{ id: "contact-site", address: "1 Existing Street, Melbourne VIC 3000" }],
}, {
  id: "history-only-customer", name: "History Only Customer", address: "", contacts: [],
  sites: [{ id: "generated-history-profile", address: "9 History Only St", _inferredProfile: true }],
}];
const jobs = [{ id: "history-only-job", customerId: "history-only-customer", jobAddress: "9 History Only St" }];
const staff = [];
const registerNavigationBlocker = () => () => {};

export default function ContactRegressionHarness() {
  const [customers, setCustomers] = useState(initialCustomers);
  const [payload, setPayload] = useState(null);
  return <UnsavedChangesContext.Provider value={{ register: registerNavigationBlocker }}>
    <button onClick={() => setCustomers((current) => structuredClone(current))}>Refresh customer records</button>
    <CreateJobPage contacts={customers.flatMap((customer) => customer.contacts)} customers={customers} jobs={jobs} staff={staff} backLabel="Test workspace"
      registerNavigationBlocker={registerNavigationBlocker} onCancel={() => {}} onCreated={() => {}}
      onSave={async (value) => { setPayload(value); return { id: "created-contact-job" }; }} />
    <pre aria-label="Created Job payload">{JSON.stringify(payload)}</pre>
  </UnsavedChangesContext.Provider>;
}

createRoot(document.getElementById("root")).render(<ContactRegressionHarness />);
