package com.kaykays.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Opens the phone's email app with the recipient, subject, body and the receipt PDF attached.
 * The share sheet cannot pre-fill a recipient, which is why this exists.
 */
@CapacitorPlugin(name = "ReceiptMail")
public class ReceiptMailPlugin extends Plugin {

    @PluginMethod
    public void compose(PluginCall call) {
        String to = call.getString("to", "");
        String subject = call.getString("subject", "");
        String body = call.getString("body", "");
        String path = call.getString("path");

        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("application/pdf");
        if (to != null && !to.trim().isEmpty()) send.putExtra(Intent.EXTRA_EMAIL, new String[] { to.trim() });
        send.putExtra(Intent.EXTRA_SUBJECT, subject);
        send.putExtra(Intent.EXTRA_TEXT, body);

        if (path != null && !path.isEmpty()) {
            File file = new File(Uri.parse(path).getPath());
            if (!file.exists()) {
                call.reject("The receipt PDF could not be found.");
                return;
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        }
        // Limits the chooser to email apps while keeping the attachment.
        send.setSelector(new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")));

        try {
            Intent chooser = Intent.createChooser(send, "Send receipt by email");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No email app is set up on this phone.");
        }
    }
}
