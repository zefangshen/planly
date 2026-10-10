import { contextBridge } from 'electron';
import { planlyApi } from './api';

contextBridge.exposeInMainWorld('planly', planlyApi);
