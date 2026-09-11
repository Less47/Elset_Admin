import { useState } from "react";
import { createRoot } from "react-dom/client";
import CreateJobPage from "../../src/components/jobs/CreateJobPage.jsx";

const initialCustomers = [{
  id: "contact-customer", name: "Contact Regression Customer", address: "1 Existing Street, Melbourne VIC 3000",
  contacts: [
    { id: "contact-a", name: "John Smith", role: "Caretaker", phone: "0400 000 111" },
    { id: "contact-b", name: "Mary Jane Brown", role: "Reception", phone: "0400 000 222" },
  ],
  sites: [{ id: "contact-site", address: "1 Existing Street, Melbourne VIC 3000" }],
}];
const jobs = [];
const staff = [];
const registerNavigationBlocker = () => () => {};

export default function ContactRegressionHarness() {
  const [customers, setCustomers] = useState(initialCustomers);
  const [payload, setPayload] = useState(null);
  return <>
    <button onClick={() => setCustomers((current) => structuredClone(current))}>Refresh customer records</button>
    <CreateJobPage customers={customers} jobs={jobs} staff={staff} backLabel="Test workspace"
      registerNavigationBlocker={registerNavigationBlocker} onCancel={() => {}} onCreated={() => {}}
      onSave={async (value) => { setPayload(value); return { id: "created-contact-job" }; }} />
    <pre aria-label="Created Job payload">{JSON.stringify(payload)}</pre>
  </>;
}

createRoot(document.getElementById("root")).render(<ContactRegressionHarness />);
