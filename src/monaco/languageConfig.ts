import { LanguageClientManager } from "monaco-languageclient/lcwrapper";
import { minLanguageClientConfig } from "../minmin/config/languageClientConfig";
import { asmLanguageClientConfig } from "../minasm/config/languageClientConfig";

// Create a central registry to handle all your running clients
const clientsManager = new LanguageClientManager();

// Initialize and manage both
export const initLanguageClients = async () => {
  clientsManager.setConfigs({
    configs: {
      minmin: minLanguageClientConfig,
      minasm: asmLanguageClientConfig,
    },
  });
  await clientsManager.start();
  return clientsManager;
};
