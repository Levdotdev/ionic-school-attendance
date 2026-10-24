package edu.minsu.attendance;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** Save private task attachments using Android's system file picker. */
@CapacitorPlugin(name = "TaskAttachments")
public class TaskAttachmentsPlugin extends Plugin {
    private volatile boolean saving = false;

    @PluginMethod
    public void save(PluginCall call) {
        if (saving) {
            call.reject("Finish saving the current attachment first.", "SAVE_IN_PROGRESS");
            return;
        }
        String data = call.getString("data");
        if (data == null || data.length() > 6990508) {
            call.reject("This attachment could not be read. Attach the file again and retry.", "INVALID_ATTACHMENT");
            return;
        }
        saving = true;
        File temporaryFile = null;
        try {
            byte[] contents = Base64.decode(data, Base64.DEFAULT);
            if (contents.length == 0 || contents.length > 5242880) throw new IllegalArgumentException("Invalid attachment size");
            temporaryFile = File.createTempFile("task-attachment-", ".tmp", getContext().getCacheDir());
            try (OutputStream output = new FileOutputStream(temporaryFile)) {
                output.write(contents);
            }
            // Keep large payloads out of Android's saved-activity Bundle.
            call.getData().remove("data");
            call.getData().put("temporaryFile", temporaryFile.getAbsolutePath());
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(call.getString("mimeType", "application/octet-stream"));
            intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "Attachment"));
            File cachedFile = temporaryFile;
            getActivity().runOnUiThread(() -> {
                try {
                    startActivityForResult(call, intent, "saveResult");
                } catch (ActivityNotFoundException | SecurityException error) {
                    discard(cachedFile);
                    saving = false;
                    call.reject("No file picker is available. Enable Android's Files app and try again.", "PICKER_UNAVAILABLE", error);
                }
            });
        } catch (IOException | IllegalArgumentException | SecurityException error) {
            discard(temporaryFile);
            saving = false;
            call.reject("Could not prepare this attachment. Check available storage and try again.", "SAVE_FAILED", error);
        }
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) { saving = false; return; }
        String path = call.getString("temporaryFile");
        File temporaryFile = path == null ? null : new File(path);
        if (result.getResultCode() != Activity.RESULT_OK) {
            discard(temporaryFile);
            saving = false;
            JSObject response = new JSObject();
            response.put("saved", false);
            call.resolve(response);
            return;
        }
        Intent resultData = result.getData();
        Uri uri = resultData == null ? null : resultData.getData();
        if (uri == null || temporaryFile == null) {
            discard(temporaryFile);
            saving = false;
            call.reject("No save location was returned. Choose a folder and try again.", "SAVE_FAILED");
            return;
        }
        execute(() -> {
            try {
                try (InputStream input = new FileInputStream(temporaryFile);
                     OutputStream output = getContext().getContentResolver().openOutputStream(uri, "w")) {
                    if (output == null) throw new IOException("The chosen folder could not be opened.");
                    byte[] buffer = new byte[8192];
                    int length;
                    while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
                    output.flush();
                }
            } catch (IOException | SecurityException error) {
                call.reject("Could not save this file. Check available storage or choose another folder and try again.", "SAVE_FAILED", error);
                return;
            } finally {
                discard(temporaryFile);
                saving = false;
            }
            JSObject response = new JSObject();
            response.put("saved", true);
            call.resolve(response);
        });
    }

    private void discard(File file) { if (file != null) file.delete(); }
}
