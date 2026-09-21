export const legalBusinessDetails = [
  ["Business name", "ELSET"],
  ["Trading name", "ELSET AUTOMATION"],
  ["Business structure", "Pty Ltd"],
  ["ABN", "93 686 524 621"],
  ["ACN", "686 652 621"],
  ["Business address", "7 Mohr St, Tullamarine, VIC 3043"],
  ["Phone", "0422 662 095"],
  ["Contact email", "admin@elset.com.au"],
  ["Website", "elset.com.au"],
  ["Privacy enquiries", "ELSET administration — admin@elset.com.au"],
];

const dates = { effectiveDate: "21 September 2026", updatedDate: "21 September 2026" };

export const legalDocuments = {
  "/legal/terms": {
    ...dates,
    label: "Terms",
    title: "ELSET Terms of Service and Software Licence",
    introduction: "These terms explain the basis on which ELSET provides its hosted field-service and business-management software. Please read them before using the service.",
    sections: [
      {
        id: "service", title: "The service and these terms",
        paragraphs: [
          "ELSET provides online tools for managing customers, sites, jobs, scheduling, quotes, invoices and related business records. Available features depend on your account, configuration and any agreed subscription.",
          "In these terms, ‘ELSET’, ‘we’, ‘us’ and ‘our’ mean the service operator identified in the business details below. ‘You’ means the customer business that holds the account and, where relevant, its authorised users. If you act for a business, you must have authority to do so. An agreed order or subscription may set out additional commercial terms; any inconsistency should be resolved with us before use.",
        ],
      },
      {
        id: "accounts", title: "Accounts and authorised users",
        paragraphs: [
          "Provide accurate account information and keep it current. Access is for people your business authorises to use ELSET, within the permissions assigned to them. You are responsible for managing those permissions and promptly removing access when it is no longer needed.",
          "Keep login details secure, do not share individual user credentials, and tell us promptly if you suspect unauthorised access. You are responsible for activity you authorise and for taking reasonable steps to protect your account; this does not remove our responsibility for the security of the service.",
        ],
      },
      {
        id: "licence", title: "Licence and acceptable use",
        paragraphs: [
          "While your account is active and you comply with these terms, we grant your business a limited, non-exclusive, non-transferable right to access and use ELSET for its internal business purposes. Your authorised users may exercise that right on your behalf. This is access to a hosted service, not a transfer of ownership of the software.",
          "Use ELSET lawfully and respect the rights of others. Do not upload unlawful content or malicious code, attempt to access accounts or systems without permission, interfere with service operation, or use the service to send spam. Do not resell the service or copy, modify or reverse engineer the software except with our written permission or where the law permits it.",
        ],
      },
      {
        id: "customer-data", title: "Your data and responsibilities",
        paragraphs: [
          "You retain ownership of the data and documents you enter or upload, and any rights you already hold in them. You give us permission to host, process, transmit and display that information only as needed to provide and support the service, carry out your instructions and meet legal obligations, as described in our Privacy Policy.",
          "You are responsible for having the right to provide that information, giving any required notices or obtaining necessary permissions, and checking its accuracy. Keep copies of records that your business needs to retain. ELSET helps manage records; it does not replace your professional judgement or accounting, tax or legal advice.",
        ],
      },
      {
        id: "intellectual-property", title: "ELSET intellectual property",
        paragraphs: [
          "ELSET and its licensors retain their rights in the software, interface, branding, documentation and other service materials. Apart from the access licence above and rights provided by law, these terms do not grant rights to that intellectual property. Your customer data remains yours.",
        ],
      },
      {
        id: "fees", title: "Subscriptions and fees",
        paragraphs: [
          "Where charges apply, the price, billing period, payment terms and any renewal or cancellation arrangements must be set out in your agreed subscription or order. Any applicable GST will be identified in that arrangement or invoice. These terms do not introduce an additional fee or a minimum subscription period by themselves.",
          "Pay amounts properly due under your agreement and contact us promptly about a disputed charge. We will give reasonable advance notice of proposed price changes, which apply prospectively in accordance with your agreement and applicable law. Refunds and remedies required by law remain available.",
        ],
      },
      {
        id: "availability", title: "Availability and maintenance",
        paragraphs: [
          "We aim to keep ELSET available and functioning reliably, but maintenance, updates, faults and events outside our reasonable control can interrupt access. Where practicable, we will provide notice of planned maintenance that materially affects use. No particular uptime or service level is promised unless separately agreed in writing.",
          "We may improve or change features over time. We will give reasonable notice of changes that materially reduce an agreed core function where practicable, and discuss available options with affected customers. These provisions do not limit any rights or remedies that the law requires us to provide.",
        ],
      },
      {
        id: "integrations", title: "QuickBooks Online, Xero and other services",
        paragraphs: [
          "ELSET may offer optional connections to Intuit QuickBooks Online, Xero and other third-party services. You choose whether to enable an integration and must be authorised to connect the relevant company or organisation. Accounting connections are authorised through the provider’s OAuth flow; do not give ELSET your QuickBooks or Xero password.",
          "Third-party services are governed by their own terms, privacy policies, permissions and charges. Their features, interfaces and availability may change, and we cannot guarantee that a third-party service or an integration will always remain available.",
          "Review account selections, customer/contact mappings, tax settings, invoices, payments and other synchronised information before relying on it or making business or reporting decisions. Synchronisation may be delayed or fail, and incorrect source data or configuration may affect results. Investigate discrepancies and obtain professional advice where appropriate. This review obligation does not excuse a failure by ELSET to meet its own legal obligations.",
        ],
      },
      {
        id: "disconnecting", title: "Disconnecting an integration",
        paragraphs: [
          "An authorised user can disconnect an accounting integration in ELSET’s accounting settings. Disconnecting removes the active connection credentials held by ELSET and stops future synchronisation through that connection. If revocation at the provider cannot be confirmed, also remove ELSET’s access in the provider’s connected-app settings.",
          "Disconnecting does not undo completed transfers or delete existing invoices, payments, mappings or synchronisation history in ELSET or the provider’s system. Manage those records separately and contact us if you need help with a data request. Any provider subscription remains subject to that provider’s terms.",
        ],
      },
      {
        id: "ending-access", title: "Suspension and termination",
        paragraphs: [
          "You may stop using ELSET and request closure of your account by contacting us. Any agreed cancellation or notice terms continue to apply, subject to your rights under law. Contact us before closure if you need assistance retrieving business records.",
          "We may restrict or suspend access where reasonably necessary to address a security threat, unlawful use, a material breach of these terms, or an overdue undisputed payment. Any restriction should be proportionate to the issue. Where safe, lawful and practicable, we will explain the reason, give reasonable notice and an opportunity to remedy the issue before taking action. Urgent security or legal concerns may require immediate action.",
          "We may terminate access for a material breach that is not remedied after reasonable notice, or where continued provision would be unlawful. If we discontinue the service for other reasons, we will give reasonable advance notice and explain options for retrieving records and handling any prepaid unused service, subject to applicable law. On termination, the access licence ends. Data retention and deletion are addressed in our Privacy Policy; closure does not automatically erase records held by connected services.",
        ],
      },
      {
        id: "liability", title: "Australian Consumer Law and liability",
        paragraphs: [
          "Australian Consumer Law and other applicable laws may give you guarantees, rights and remedies that cannot be excluded, restricted or modified by agreement. Nothing in these terms excludes, restricts or modifies those protections. Any remedy required by those laws remains available, including for services that do not meet applicable consumer guarantees.",
          "Subject to those protections, each party is responsible for loss caused by its breach of these terms or negligence. To the extent permitted by law, neither party is liable for loss that was not reasonably foreseeable when entering this agreement. A party’s liability is reduced only to the extent the other party caused or contributed to the loss or failed to take reasonable steps to reduce it.",
          "No limitation in these terms applies to fraud, wilful misconduct, or liability that cannot lawfully be limited. References to interruptions, third-party services or your responsibilities do not remove our obligation to provide the service with the care required by law.",
        ],
      },
      {
        id: "law-and-changes", title: "Governing law and changes",
        paragraphs: [
          "These terms are governed by the laws of Victoria, Australia. The parties submit to the non-exclusive jurisdiction of the courts of Victoria and courts hearing appeals from them. This does not prevent you exercising mandatory rights or bringing a claim in another forum where applicable law permits it.",
          "We may update these terms to reflect changes in the service or legal requirements. We will publish the revised terms and update the date on this page, and give reasonable advance notice of material changes where practicable. Urgent legal or security changes may take effect sooner, with notice as soon as reasonably practicable. Changes apply prospectively and do not retrospectively remove accrued rights. Contact us about any material change you cannot accept and the available options for ending your subscription, subject to your agreement and applicable law.",
        ],
      },
    ],
  },
  "/legal/privacy": {
    ...dates,
    label: "Privacy",
    title: "ELSET Privacy Policy",
    introduction: "This policy explains how ELSET handles personal information in providing its hosted field-service and business-management software, including optional accounting integrations.",
    sections: [
      {
        id: "about", title: "Who handles your information",
        paragraphs: [
          "‘ELSET’, ‘we’, ‘us’ and ‘our’ refer to the service operator identified in the business details below. We handle account and service information to operate ELSET. Customer businesses also enter information about their own staff, customers and other contacts into their workspaces, and are responsible for their decisions about that information and the notices they give those people.",
          "If your information was entered by a business using ELSET, contact that business first about its use of your information. You can also contact us about information we hold or if you need help identifying the appropriate contact.",
        ],
      },
      {
        id: "information", title: "Information we may process",
        paragraphs: ["The information involved depends on how your business uses ELSET and which features it enables. It may include:"],
        items: [
          "Account and user details, such as names, usernames, email addresses, roles, permissions and account authentication records.",
          "Customer and site details, such as contact names, business details, addresses, site locations, access information and service notes.",
          "Job and scheduling information, including work descriptions, assigned staff, appointments, status updates and job history.",
          "Quotes, invoices and related financial records, including line items, amounts, tax information and payment status.",
          "Uploaded photos, attachments and documents where those features are used, including information contained in those files.",
          "Accounting connection details and records needed for synchronisation, as explained below.",
          "Technical and security information, such as session records, error reports and integration activity logs, and network or device details where generated by the service or its hosting and security providers.",
        ],
      },
      {
        id: "collection", title: "How information reaches ELSET",
        paragraphs: [
          "We receive information when users create or administer an account, enter or upload business records, contact us for support, or use the service. We may also receive information from an accounting provider when an authorised user enables that connection. Some technical information is generated automatically during service operation.",
          "Only provide information your business is authorised to use and that is needed for the relevant task. Some information is necessary to create an account or provide a requested feature; without it, that feature may not be available.",
        ],
      },
      {
        id: "accounting", title: "QuickBooks Online and Xero integrations",
        paragraphs: [
          "An authorised user connects Intuit QuickBooks Online or Xero through the provider’s OAuth authorisation flow. ELSET does not need or store your QuickBooks or Xero password. The provider supplies connection credentials that allow ELSET to perform the functions you authorise, subject to the provider’s permissions.",
          "Connection information may include OAuth access and refresh tokens, granted permissions, token expiry details, company or organisation identifiers, and connection status. Synchronisation may involve customer/contact mappings, invoice mappings, and invoice, tax, payment and related accounting information required for the enabled functions. ELSET may keep synchronisation history and error details to support reconciliation and troubleshooting.",
          "You may disconnect an accounting integration in ELSET’s accounting settings. This removes the active connection credentials held by ELSET and stops future synchronisation through that connection. If provider-side revocation is not confirmed, also remove access in the provider’s connected-app settings. Disconnecting does not delete previously transferred records, mappings or history, or information held independently by Intuit or Xero. You can make a separate deletion request as described below.",
        ],
      },
      {
        id: "purposes", title: "Why we use information",
        items: [
          "Provide ELSET functionality and operate the service for your business.",
          "Manage customer, site, job and scheduling records and prepare quotes and invoices.",
          "Synchronise accounting records with services your business chooses to connect.",
          "Authenticate users, apply permissions, protect accounts and investigate suspected misuse.",
          "Troubleshoot errors, respond to support requests and maintain service reliability.",
          "Administer the business relationship, communicate about the service and meet applicable legal obligations.",
        ],
      },
      {
        id: "sharing", title: "When information is shared",
        paragraphs: [
          "ELSET does not sell customer data. We share information only where needed for service operation, your instructions or an applicable legal basis. Users within your business may access information according to their assigned permissions, and information may be sent to recipients your users choose, such as invoice recipients.",
          "Service providers may process information on our behalf where needed for hosting, storage, communications, technical support and security. We seek to limit their access to what is needed for their role. When you enable a connected service such as Intuit QuickBooks Online or Xero, relevant information is exchanged with that provider to perform the authorised functions.",
          "We may disclose information when required by law or a valid legal process, or where permitted by law and reasonably necessary to protect people, investigate misuse or establish, exercise or defend legal rights. We consider the scope of such requests and limit disclosure as appropriate.",
        ],
      },
      {
        id: "cloud", title: "Cloud and international processing",
        paragraphs: [
          "ELSET and its service providers use cloud systems. Depending on the services used and their arrangements, information may be stored in, accessed from or processed in countries outside Australia. Connected accounting providers also determine where they process information under their own policies.",
          "Processing locations can depend on the provider and configuration. Contact us for current information about the arrangements relevant to your account. We consider privacy and security when selecting service providers and addressing cross-border handling; this policy does not promise that all information remains in Australia.",
        ],
      },
      {
        id: "retention", title: "Retention and deletion",
        paragraphs: [
          "We retain information for as long as reasonably needed to provide the service, maintain business records, resolve disputes, protect security and meet legal obligations. The appropriate period depends on the type of record, your account arrangements and applicable requirements; there is no single retention period for all information.",
          "You may request deletion of information or closure of an account using the contact details below. We may need to verify your identity and authority and consult the business that controls the relevant workspace. Some information may need to be retained for legal obligations, legitimate record-keeping or resolving a dispute. We will explain any applicable limitations and the next steps.",
          "Account closure or disconnection does not automatically delete all records. Copies in backups may remain until those backups are replaced through normal retention processes. Records already sent to third parties are subject to their own retention and deletion arrangements. Request any business records you need before closing an account.",
        ],
      },
      {
        id: "security", title: "Security",
        paragraphs: [
          "ELSET uses authentication and permission controls to restrict access. Accounting connection credentials are encrypted when stored by ELSET. We take reasonable steps appropriate to the information and service to reduce the risk of unauthorised access, misuse or loss.",
          "No system or transmission method can be guaranteed completely secure. Your business should protect user credentials, manage permissions and notify us promptly of suspected unauthorised access. Do not send passwords or accounting connection tokens in support requests.",
        ],
      },
      {
        id: "requests", title: "Access, corrections and privacy concerns",
        paragraphs: [
          "Contact us to request access to or correction of personal information, request deletion, or raise a privacy concern. Describe the information and the workspace involved without including passwords or unnecessary sensitive information. We may ask for enough information to verify your identity and authority before responding.",
          "Where a customer business manages the record, it may be able to make the correction directly or we may refer the request to it. We will consider requests and respond within a reasonable period, subject to applicable law. If we cannot fulfil a request, we will explain why where permitted and discuss available options. You may also have rights to contact a relevant regulator under applicable law.",
        ],
      },
      {
        id: "cookies", title: "Cookies and session technology",
        paragraphs: [
          "ELSET uses cookies and related browser storage to support sign-in, maintain sessions and remember relevant preferences. These technologies help the service recognise authenticated users and function correctly. Browser settings can restrict or delete cookies and stored data, but doing so may sign you out or affect functionality.",
          "Third-party services you visit or authorise may use their own cookies and similar technologies under their own policies.",
        ],
      },
      {
        id: "third-parties", title: "Third-party services",
        paragraphs: [
          "This policy describes ELSET’s handling of information. Intuit QuickBooks Online, Xero and other third-party services have their own privacy policies and terms. Review those documents and the permissions requested before authorising a connection. ELSET does not control a provider’s independent handling of information.",
        ],
      },
      {
        id: "children", title: "Children and business use",
        paragraphs: [
          "ELSET is intended for business use and is not directed at children. Businesses should only provide personal information that is appropriate and necessary for their work and that they are authorised to share. Contact us if you believe a child has provided information to ELSET without appropriate authority so we can consider the circumstances and appropriate action.",
        ],
      },
      {
        id: "changes", title: "Changes to this policy",
        paragraphs: [
          "We may update this policy as the service or our information-handling practices change. The updated version will be published here with a revised date. We will take reasonable steps to bring material changes to affected users’ attention, and provide any further notice or obtain any consent required by applicable law.",
        ],
      },
    ],
  },
};
