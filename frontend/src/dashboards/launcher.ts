import { createContext, useContext } from 'react';

/** True inside the role dashboards, which sit on the blue app-launcher backdrop: text outside cards turns white there. */
export const LauncherContext = createContext(false);
export const useOnLauncher = () => useContext(LauncherContext);
