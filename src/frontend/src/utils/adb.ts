import { Adb, AdbDaemonTransport, AdbShellProtocolProcess, encodeUtf8 } from "@yume-chan/adb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { AdbDaemonWebUsbDevice, AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";


async function sendDjiGoFileViaAdb(data: Blob) {
    const adb = await _getAdbConnection();
    if (!adb) return;

    const base64String = await _encodeDataAsBase64String(data);

    // Need to find first existing waypoint directory available
    const waypointDir = `/sdcard/Android/data`;
    const listDirs = await adb.subprocess.shellProtocol!.spawn(
        `ls -1 ${waypointDir}`
      );
    const dirOutput = await _readShellOutput(listDirs);
    const dirs = dirOutput.split('\n').filter(Boolean);
    if (dirs.length === 0) {
        throw new Error(`A waypoint flight must flown first`);
    }
    const firstDir = dirs[0];
    // Then find the .kmz file within that dir
    const targetPath = `${waypointDir}/${firstDir}`;
    const listFiles = await adb.subprocess.shellProtocol!.spawn(
      `ls -1 ${targetPath}/*.kmz`
    );
    const filesOutput = await _readShellOutput(listFiles);
    const kmzFiles = filesOutput.split('\n').filter(Boolean);
    if (kmzFiles.length === 0) {
      throw new Error(`No .kmz files found in ${targetPath}`);
    }
    const targetFile = kmzFiles[0];
    console.log(`Replacing: ${targetFile}`);

    // // Send file to phone via ADB STDIN
    const process = await adb.subprocess.shellProtocol!.spawn(
        `sh -c "base64 -d > '${targetFile}'"`
    );
    const writer = process.stdin.getWriter();
    await writer.write(encodeUtf8(base64String));
    console.log(`Successfully replaced: ${targetFile}`);
    console.log(`Copied flightplan to ${targetFile}`)
}

async function sendPotensicProFileViaAdb(data: Blob) {
    const adb = await _getAdbConnection();
    if (!adb) return;

    const base64String = await _encodeDataAsBase64String(data);

    // Cleanup old journal files
    await adb.subprocess.shellProtocol!.spawn("run-as com.ipotensic.potensicpro rm -f databases/map.db-journal");
    console.log('Deleted db journal')

    // Send file to phone via ADB STDIN
    const process = await adb.subprocess.shellProtocol!.spawn(
        `run-as com.ipotensic.potensicpro sh -c "base64 -d > databases/test.db"`
    );
    const writer = process.stdin.getWriter();
    // Send as UTF-8 encoded data
    await writer.write(encodeUtf8(base64String));
    console.log('Copied flightplan to databases/map.db')
}

async function _readShellOutput(process: AdbShellProtocolProcess): Promise<string> {
    const decoder = new TextDecoder();
    const reader = process.stdout.getReader();
    let output = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        output += decoder.decode(value);
    }
    return output;
}

async function _encodeDataAsBase64String(data: Blob): Promise<string> {
    return await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        resolve(btoa(binary));
        };
        reader.readAsArrayBuffer(data);
    });
}

async function _getAdbConnection(): Promise<Adb | undefined> {
    const Manager: AdbDaemonWebUsbDeviceManager | undefined = AdbDaemonWebUsbDeviceManager.BROWSER;

    if (!Manager) {
        alert("WebUSB is not supported in this browser");
        return;
    }

    const CredentialStore = new AdbWebCredentialStore();

    const device: AdbDaemonWebUsbDevice | undefined = await Manager.requestDevice();
    if (!device) {
        alert("No device selected");
        return;
    }

    const connection = await device.connect();
    const adb = new Adb(
        await AdbDaemonTransport.authenticate({
            serial: device.serial,
            connection,
            credentialStore: CredentialStore,
        })
    );

    return adb;
}

export {
    sendDjiGoFileViaAdb,
    sendPotensicProFileViaAdb,
}
