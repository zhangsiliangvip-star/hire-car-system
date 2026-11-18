"use client";

import { useEffect } from "react";

export function DisablePersonalAutofill() {
  useEffect(() => {
    function disable(element: Element) {
      if (element.matches("form, input:not([type=password]), textarea, select") &&
        element.getAttribute("autocomplete") !== "off") {
        element.setAttribute("autocomplete", "off");
      }
    }
    function scan(element: Element) {
      disable(element);
      element.querySelectorAll("form, input, textarea, select").forEach(disable);
    }
    scan(document.body);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof Element) disable(record.target);
        for (const node of record.addedNodes) if (node instanceof Element) scan(node);
      }
    });
    observer.observe(document.body, {
      subtree: true, childList: true, attributes: true, attributeFilter: ["autocomplete", "type"],
    });
    return () => observer.disconnect();
  }, []);
  return null;
}
