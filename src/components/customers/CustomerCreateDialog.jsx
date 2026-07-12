import { useEffect, useState } from "react";
import { AddressAutocompleteInput } from "@/components/shared/AddressAutocompleteInput";
import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { customerTypeOptions, siteTypeOptions } from "@/lib/app-support";

const NOT_SET_VALUE = "not-set";
const TEXT_INPUT_CLASSNAME = "bg-white shadow-sm";

export default function CustomerCreateDialog({ open, onOpenChange, onSave }) {
  const [customer, setCustomer] = useState({
    name: "",
    email: "",
    phone: "",
    customerType: "",
    address: "",
    primarySiteType: "",
    primaryOcNumber: "",
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setCustomer({ name: "", email: "", phone: "", customerType: "", address: "", primarySiteType: "", primaryOcNumber: "" });
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const canSave = customer.name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Create Customer</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <div className="grid gap-4">
            <FormField label="Customer / company name">
              <Input
                className={TEXT_INPUT_CLASSNAME}
                value={customer.name}
                onChange={(e) => setCustomer((prev) => ({ ...prev, name: e.target.value }))}
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Email">
                <Input
                  className={TEXT_INPUT_CLASSNAME}
                  value={customer.email}
                  onChange={(e) => setCustomer((prev) => ({ ...prev, email: e.target.value }))}
                />
              </FormField>
              <FormField label="Phone number">
                <Input
                  className={TEXT_INPUT_CLASSNAME}
                  value={customer.phone}
                  onChange={(e) => setCustomer((prev) => ({ ...prev, phone: e.target.value }))}
                />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Customer type">
                <Select
                  value={customer.customerType || NOT_SET_VALUE}
                  onValueChange={(value) => setCustomer((prev) => ({ ...prev, customerType: value === NOT_SET_VALUE ? "" : value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_SET_VALUE}>Not set</SelectItem>
                    {customerTypeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Primary site type">
                <Select
                  value={customer.primarySiteType || NOT_SET_VALUE}
                  onValueChange={(value) => setCustomer((prev) => ({ ...prev, primarySiteType: value === NOT_SET_VALUE ? "" : value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select site type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_SET_VALUE}>Not set</SelectItem>
                    {siteTypeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>
            <FormField label="Address">
              <AddressAutocompleteInput
                className={TEXT_INPUT_CLASSNAME}
                value={customer.address}
                onChange={(value) => setCustomer((prev) => ({ ...prev, address: value }))}
                placeholder="Search the customer's main address"
              />
            </FormField>
            <FormField label="Primary OC number">
              <Input
                className={TEXT_INPUT_CLASSNAME}
                value={customer.primaryOcNumber}
                onChange={(e) => setCustomer((prev) => ({ ...prev, primaryOcNumber: e.target.value }))}
                placeholder="Optional client order/control number"
              />
            </FormField>
          </div>

        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            onClick={async () => {
              const saved = await onSave(customer);
              if (saved) {
                onOpenChange(false);
              }
            }}
          >
            Create Customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
