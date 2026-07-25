from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("core", "0002_admin_user")]
    operations = [migrations.RemoveField(model_name="project", name="version")]
