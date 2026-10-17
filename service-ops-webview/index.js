/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { bootTask } from './src/location/bootTask';

AppRegistry.registerComponent(appName, () => App);

/**
 * Telefon açılınca konum takibini geri kuran görev.
 *
 * Ad ("ServiceOpsBoot") native taraftaki `BootTaskService.getTaskConfig` ile BİREBİR aynı olmak
 * zorunda; uyuşmazsa Android görevi bulamaz ve açılışta sessizce hiçbir şey olmaz.
 */
AppRegistry.registerHeadlessTask('ServiceOpsBoot', () => bootTask);
